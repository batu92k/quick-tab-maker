/**
 * Mutating operations on a song document.
 *
 * Every function takes an Immer draft and mutates it in place; the store wraps
 * them in `produce`, which turns each call into a patch pair for undo/redo. The
 * rule is that an operation either completes and leaves the document valid, or
 * returns without touching it — never a half-applied edit, because a patch that
 * cannot be inverted cleanly corrupts the history stack.
 *
 * Invariants maintained here:
 *  - a measure's beats are sorted by `start` and sit back-to-back from zero
 *  - a measure never holds more musical time than its time signature allows
 *  - at most one note per string in a beat
 *  - the song-level marker lists stay sorted, deduplicated and start at bar 0
 */

import type { Draft } from 'immer';
import * as F from './fraction';
import type { Fraction } from './fraction';
import { newNoteId } from './ids';
import { createBeat, createMeasure, measureCapacity } from './song';
import {
  isDrumTrack,
  isStringTrack,
  type Annotation,
  type DrumArticulation,
  type DrumNote,
  type DrumPiece,
  type DrumTrack,
  type Id,
  type Measure,
  type Note,
  type Song,
  type StringTrack,
  type Technique,
  type TimeSignature,
  type Track,
} from './types';

type D<T> = Draft<T>;

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

function getTrack(song: D<Song>, trackId: Id): D<Track> | undefined {
  return song.tracks.find((t) => t.id === trackId);
}

function getStringTrack(song: D<Song>, trackId: Id): D<StringTrack> | undefined {
  const track = getTrack(song, trackId);
  return track && isStringTrack(track) ? track : undefined;
}

function getDrumTrack(song: D<Song>, trackId: Id): D<DrumTrack> | undefined {
  const track = getTrack(song, trackId);
  return track && isDrumTrack(track) ? track : undefined;
}

/**
 * A measure viewed without regard to what kind of note it holds.
 *
 * Rhythm operations — durations, insert, delete, re-flow — are identical for
 * guitar and drum tracks, but Immer's draft types make `Measure<Note> |
 * Measure<DrumNote>` invariant in its notes array, so a generic function cannot
 * accept both. Narrowing to the structural shape those operations actually use
 * is the honest fix; the alternative is duplicating every rhythm operation per
 * track kind.
 */
interface BeatLike {
  id: Id;
  start: Fraction;
  duration: Fraction;
  notes: unknown[];
}
interface MeasureLike {
  beats: BeatLike[];
}

function asMeasureLike(measure: D<Measure<Note>> | D<Measure<DrumNote>>): MeasureLike {
  return measure as unknown as MeasureLike;
}

/** Re-derives `start` for every beat and drops the trailing empty ones. */
function normalise(measure: MeasureLike): void {
  // Trailing rests carry no information — a bar that ends early already renders
  // as empty — and keeping them would let repeated edits grow the list forever.
  while (measure.beats.length > 0 && measure.beats[measure.beats.length - 1]!.notes.length === 0) {
    measure.beats.pop();
  }
  // Mutated in place rather than reassigned, so the drafted array identity (and
  // therefore Immer's patch for it) stays minimal.
  let cursor = F.ZERO;
  for (const beat of measure.beats) {
    if (!F.eq(beat.start, cursor)) beat.start = cursor;
    cursor = F.add(cursor, beat.duration);
  }
}

function usedTime(measure: MeasureLike): Fraction {
  return measure.beats.reduce((acc, b) => F.add(acc, b.duration), F.ZERO);
}

/**
 * Grows a measure so index `beatIndex` exists, padding with rests of
 * `fillDuration`, and refuses to exceed the bar's capacity.
 *
 * Returns the beat, or undefined if the bar has no room — which is how the
 * caller distinguishes "typed past the end of the bar" from a real edit.
 */
function ensureBeat(
  measure: MeasureLike,
  beatIndex: number,
  fillDuration: Fraction,
  capacity: Fraction,
): BeatLike | undefined {
  if (beatIndex < 0) return undefined;

  while (measure.beats.length <= beatIndex) {
    const used = usedTime(measure);
    if (F.gt(F.add(used, fillDuration), capacity)) return undefined;
    measure.beats.push(createBeat(used, fillDuration) as unknown as BeatLike);
  }
  return measure.beats[beatIndex];
}

/** Keeps a marker list sorted by bar with one entry per bar, bar 0 always present. */
function upsertMarker<T extends { bar: number }>(list: D<T>[], marker: D<T>): void {
  const existing = list.findIndex((m) => m.bar === marker.bar);
  if (existing >= 0) list[existing] = marker;
  else list.push(marker);
  list.sort((a, b) => a.bar - b.bar);
}

function touch(song: D<Song>): void {
  song.updatedAt = new Date().toISOString();
}

/* -------------------------------------------------------------------------- */
/* String-track note entry                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Places a fret number on a string, replacing whatever was there.
 *
 * This is the workhorse behind every entry route — typing a digit, clicking the
 * fretboard, and (later) a MIDI note resolved to a position all land here.
 */
export function setNote(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  stringIndex: number,
  fret: number,
  entryDuration: Fraction,
): boolean {
  const track = getStringTrack(song, trackId);
  const measure = track?.measures[measureIndex];
  if (!track || !measure) return false;
  if (stringIndex < 0 || stringIndex >= track.tuning.length) return false;
  if (fret < 0 || fret > track.fretCount) return false;

  const view = asMeasureLike(measure);
  const capacity = measureCapacity(song as Song, track as StringTrack, measureIndex);
  const beat = ensureBeat(view, beatIndex, entryDuration, capacity);
  if (!beat) return false;

  const notes = beat.notes as Note[];
  const existing = notes.findIndex((n) => n.string === stringIndex);
  if (existing >= 0) {
    // Preserve techniques and velocity so retyping a fret is a correction,
    // not a reset of everything else the user set on that note.
    notes[existing] = { ...notes[existing]!, fret };
  } else {
    notes.push({ id: newNoteId(), string: stringIndex, fret, techniques: [] });
    // Keep notes ordered low string to high so the renderer and the audio
    // engine can walk a chord in a predictable order.
    notes.sort((a, b) => a.string - b.string);
  }
  normalise(view);
  touch(song);
  return true;
}

/** Removes the note on a string. Returns false if there was nothing there. */
export function removeNote(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  stringIndex: number,
): boolean {
  const track = getStringTrack(song, trackId);
  const beat = track?.measures[measureIndex]?.beats[beatIndex];
  if (!track || !beat) return false;

  const at = beat.notes.findIndex((n) => n.string === stringIndex);
  if (at < 0) return false;
  beat.notes.splice(at, 1);
  normalise(asMeasureLike(track.measures[measureIndex]!));
  touch(song);
  return true;
}

/** Toggles a technique on a note. Returns false if there is no note there. */
export function toggleTechnique(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  stringIndex: number,
  technique: Technique,
): boolean {
  const track = getStringTrack(song, trackId);
  const beat = track?.measures[measureIndex]?.beats[beatIndex];
  const note = beat?.notes.find((n) => n.string === stringIndex);
  if (!note) return false;

  const at = note.techniques.indexOf(technique);
  if (at >= 0) note.techniques.splice(at, 1);
  else note.techniques.push(technique);
  touch(song);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Drum-track note entry                                                      */
/* -------------------------------------------------------------------------- */

/** Toggles a drum piece on or off at a beat — the natural gesture for a grid. */
export function toggleDrumNote(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  piece: DrumPiece,
  entryDuration: Fraction,
  articulation: DrumArticulation = 'normal',
): boolean {
  const track = getDrumTrack(song, trackId);
  const measure = track?.measures[measureIndex];
  if (!track || !measure) return false;

  const view = asMeasureLike(measure);
  const capacity = measureCapacity(song as Song, track as DrumTrack, measureIndex);
  const beat = ensureBeat(view, beatIndex, entryDuration, capacity);
  if (!beat) return false;

  const notes = beat.notes as DrumNote[];
  const at = notes.findIndex((n) => n.piece === piece);
  if (at >= 0) {
    // Same piece, different articulation = change it; same articulation = remove.
    if (notes[at]!.articulation !== articulation) {
      notes[at] = { ...notes[at]!, articulation };
    } else {
      notes.splice(at, 1);
    }
  } else {
    notes.push({ id: newNoteId(), piece, articulation });
  }
  normalise(view);
  touch(song);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Rhythm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Changes a beat's duration and re-flows the rest of the bar.
 *
 * Refuses if the bar would overflow, rather than silently pushing notes into
 * the next measure — spilling across a bar line is a destructive surprise, and
 * the user can always lengthen the bar's time signature deliberately.
 */
export function setBeatDuration(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  duration: Fraction,
): boolean {
  const track = getTrack(song, trackId);
  const measure = track?.measures[measureIndex];
  const beat = measure?.beats[beatIndex];
  if (!track || !measure || !beat) return false;
  if (!F.isPositive(duration)) return false;

  const view = asMeasureLike(measure);
  const capacity = measureCapacity(song as Song, track as Track, measureIndex);
  const proposed = F.add(F.sub(usedTime(view), beat.duration), duration);
  if (F.gt(proposed, capacity)) return false;

  beat.duration = duration;
  normalise(view);
  touch(song);
  return true;
}

/** Inserts an empty beat at `beatIndex`, shifting later beats right. */
export function insertBeat(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
  duration: Fraction,
): boolean {
  const track = getTrack(song, trackId);
  const measure = track?.measures[measureIndex];
  if (!track || !measure) return false;

  const view = asMeasureLike(measure);
  const capacity = measureCapacity(song as Song, track as Track, measureIndex);
  if (F.gt(F.add(usedTime(view), duration), capacity)) return false;

  const index = Math.min(Math.max(beatIndex, 0), view.beats.length);
  view.beats.splice(index, 0, createBeat(F.ZERO, duration) as unknown as BeatLike);
  normalise(view);
  touch(song);
  return true;
}

/** Deletes a beat entirely, closing the gap. */
export function deleteBeat(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
): boolean {
  const measure = getTrack(song, trackId)?.measures[measureIndex];
  if (!measure || beatIndex < 0 || beatIndex >= measure.beats.length) return false;
  const view = asMeasureLike(measure);
  view.beats.splice(beatIndex, 1);
  normalise(view);
  touch(song);
  return true;
}

/** Clears every note from a beat, leaving a rest of the same length. */
export function clearBeat(
  song: D<Song>,
  trackId: Id,
  measureIndex: number,
  beatIndex: number,
): boolean {
  const measure = getTrack(song, trackId)?.measures[measureIndex];
  const beat = measure?.beats[beatIndex];
  if (!measure || !beat) return false;
  if (beat.notes.length === 0) return false;
  beat.notes = [];
  normalise(asMeasureLike(measure));
  touch(song);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Measures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Inserts an empty measure at `index` in every track.
 *
 * Measures are inserted across all tracks at once so the tracks stay bar-
 * aligned. Letting one track drift by a bar would desynchronise playback and
 * make the multi-track score meaningless.
 */
export function insertMeasure(song: D<Song>, index: number): void {
  for (const track of song.tracks) {
    const at = Math.min(Math.max(index, 0), track.measures.length);
    track.measures.splice(at, 0, createMeasure() as never);
  }
  shiftMarkers(song, index, 1);
  shiftAnnotations(song, index, 1);
  touch(song);
}

/** Deletes a measure from every track. Refuses to delete the last one. */
export function deleteMeasure(song: D<Song>, index: number): boolean {
  const longest = song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
  if (longest <= 1 || index < 0 || index >= longest) return false;
  for (const track of song.tracks) {
    if (index < track.measures.length) track.measures.splice(index, 1);
  }
  shiftMarkers(song, index, -1);
  shiftAnnotations(song, index, -1);
  touch(song);
  return true;
}

export function appendMeasure(song: D<Song>): void {
  const longest = song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
  insertMeasure(song, longest);
}

/**
 * Moves tempo and time-signature markers when bars are inserted or removed.
 * Markers at bar 0 are pinned, since the song must always have a starting tempo
 * and signature.
 */
function shiftMarkers(song: D<Song>, fromBar: number, delta: number): void {
  const shift = <T extends { bar: number }>(list: D<T>[]): D<T>[] =>
    list
      .filter((m) => m.bar === 0 || !(delta < 0 && m.bar === fromBar))
      .map((m) => (m.bar > fromBar || (delta > 0 && m.bar === fromBar) ? { ...m, bar: m.bar + delta } : m))
      .filter((m) => m.bar >= 0);

  song.tempoMap = shift(song.tempoMap);
  song.timeSignatures = shift(song.timeSignatures);
}

/* -------------------------------------------------------------------------- */
/* Song-level settings                                                        */
/* -------------------------------------------------------------------------- */

export function setTitle(song: D<Song>, title: string): void {
  song.title = title;
  touch(song);
}

export function setArtist(song: D<Song>, artist: string): void {
  song.artist = artist;
  touch(song);
}

export function setKey(song: D<Song>, key: Song['key']): void {
  song.key = key;
  touch(song);
}

/** Sets the tempo from `bar` onward. Bar 0 changes the song's base tempo. */
export function setTempo(song: D<Song>, bpm: number, bar = 0): boolean {
  if (!(bpm > 0) || bpm > 400) return false;
  upsertMarker(song.tempoMap, { bar, bpm });
  touch(song);
  return true;
}

/** Sets the time signature from `bar` onward. */
export function setTimeSignature(song: D<Song>, sig: TimeSignature, bar = 0): boolean {
  if (!Number.isInteger(sig.num) || sig.num < 1 || sig.num > 32) return false;
  if (![1, 2, 4, 8, 16, 32].includes(sig.den)) return false;
  upsertMarker(song.timeSignatures, { bar, num: sig.num, den: sig.den });
  touch(song);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Tracks                                                                     */
/* -------------------------------------------------------------------------- */

/** Adds a track, padded to the song's current length so bars stay aligned. */
export function addTrack(song: D<Song>, track: Track): void {
  const longest = song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
  const draft = track as D<Track>;
  while (draft.measures.length < longest) draft.measures.push(createMeasure() as never);
  song.tracks.push(draft);
  touch(song);
}

/** Removes a track. Refuses to remove the last one — a song needs a staff. */
export function removeTrack(song: D<Song>, trackId: Id): boolean {
  if (song.tracks.length <= 1) return false;
  const at = song.tracks.findIndex((t) => t.id === trackId);
  if (at < 0) return false;
  song.tracks.splice(at, 1);
  touch(song);
  return true;
}

export function renameTrack(song: D<Song>, trackId: Id, name: string): boolean {
  const track = getTrack(song, trackId);
  if (!track) return false;
  track.name = name;
  touch(song);
  return true;
}

export function setMixer(
  song: D<Song>,
  trackId: Id,
  changes: Partial<Track['mixer']>,
): boolean {
  const track = getTrack(song, trackId);
  if (!track) return false;
  Object.assign(track.mixer, changes);
  touch(song);
  return true;
}

/**
 * Changes a track's tuning.
 *
 * Existing notes keep their string and fret, so the tab looks identical and
 * sounds transposed — which is what a user retuning a song expects. Notes on
 * strings that no longer exist are dropped.
 */
export function setTuning(song: D<Song>, trackId: Id, tuning: readonly string[]): boolean {
  const track = getStringTrack(song, trackId);
  if (!track || tuning.length === 0) return false;

  track.tuning = [...tuning];
  // Drop notes stranded on strings the new tuning no longer has. A no-op when
  // the string count is unchanged or grows, so it needs no special case.
  for (const measure of track.measures) {
    for (const beat of measure.beats) {
      if (beat.notes.some((n) => n.string >= tuning.length)) {
        beat.notes = beat.notes.filter((n) => n.string < tuning.length);
      }
    }
    normalise(asMeasureLike(measure));
  }
  touch(song);
  return true;
}

export function setCapo(song: D<Song>, trackId: Id, capo: number): boolean {
  const track = getStringTrack(song, trackId);
  if (!track || capo < 0 || capo > 12 || !Number.isInteger(capo)) return false;
  track.capo = capo;
  touch(song);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Annotations                                                                */
/* -------------------------------------------------------------------------- */

/** Keeps the list ordered so rendering is stable and bars group together. */
function sortAnnotations(song: D<Song>): void {
  song.annotations.sort((a, b) => a.bar - b.bar || F.cmp(a.offset, b.offset));
}

/**
 * Moves annotations when bars are inserted or removed, mirroring `shiftMarkers`
 * — but unlike the marker lists, annotations are not pinned at bar 0, and a bar
 * that is deleted takes its annotations with it. Their offset within the bar is
 * left alone: the note travels with its bar, not with an absolute position.
 */
function shiftAnnotations(song: D<Song>, fromBar: number, delta: number): void {
  if (delta < 0) {
    song.annotations = song.annotations.filter((a) => a.bar !== fromBar);
  }
  for (const a of song.annotations) {
    if (a.bar > fromBar || (delta > 0 && a.bar === fromBar)) a.bar += delta;
  }
}

/** Adds a text note. The caller supplies the id so it can focus the new box. */
export function addAnnotation(song: D<Song>, annotation: Annotation): void {
  song.annotations.push({ ...annotation });
  sortAnnotations(song);
  touch(song);
}

export function setAnnotationText(song: D<Song>, id: Id, text: string): boolean {
  const annotation = song.annotations.find((a) => a.id === id);
  if (!annotation) return false;
  annotation.text = text;
  touch(song);
  return true;
}

/** Re-anchors a note to a different bar and position. */
export function moveAnnotation(song: D<Song>, id: Id, bar: number, offset: Fraction): boolean {
  const annotation = song.annotations.find((a) => a.id === id);
  if (!annotation || bar < 0 || !Number.isInteger(bar)) return false;
  annotation.bar = bar;
  annotation.offset = offset;
  sortAnnotations(song);
  touch(song);
  return true;
}

export function removeAnnotation(song: D<Song>, id: Id): boolean {
  const at = song.annotations.findIndex((a) => a.id === id);
  if (at < 0) return false;
  song.annotations.splice(at, 1);
  touch(song);
  return true;
}
