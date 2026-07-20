/**
 * Editor commands.
 *
 * Every user gesture — a keystroke, a click on the fretboard, a drum pad, and
 * later a MIDI note — funnels through these functions rather than calling the
 * store directly. That keeps the "what happens when a note is entered" logic in
 * one place: advance the cursor, respect the entry duration, stay inside the
 * bar. Input devices only have to decide *what* was played, not what it means.
 */

import * as E from '../model/edit';
import type { Fraction } from '../model/fraction';
import { isDrumTrack, isStringTrack, type DrumPiece, type Track } from '../model/types';
import { defaultPieceForRow, rowForPiece, DRUM_ROW_COUNT } from '../theory/drums';
import { useSongStore, type EditorState } from '../store/songStore';
import * as D from './durations';

type Store = EditorState;

const store = (): Store => useSongStore.getState();

/** The track the cursor is on, if any. */
export function currentTrack(): Track | undefined {
  const { song, cursor } = store();
  if (!song || !cursor) return undefined;
  return song.tracks.find((t) => t.id === cursor.trackId);
}

/**
 * Converts a visual line back to a string index.
 *
 * The cursor's `line` is a visual row with 0 at the top, but the document
 * indexes strings from the lowest pitch. This is the same inversion the
 * renderer applies, and getting it wrong here would enter notes on the mirrored
 * string — so both directions live next to their own tests.
 */
export function stringForLine(track: Track, line: number): number {
  return isStringTrack(track) ? track.tuning.length - 1 - line : line;
}

export function lineForString(track: Track, stringIndex: number): number {
  return isStringTrack(track) ? track.tuning.length - 1 - stringIndex : stringIndex;
}

/* -------------------------------------------------------------------------- */
/* Note entry                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Writes a fret at the cursor.
 *
 * Returns false when the edit was refused — the bar is full, or the fret is out
 * of range — so the caller can avoid advancing the cursor past a note that was
 * never written.
 */
export function setFretAtCursor(fret: number): boolean {
  const { cursor, entryDuration } = store();
  const track = currentTrack();
  if (!cursor || !track || !isStringTrack(track)) return false;

  const stringIndex = stringForLine(track, cursor.line);
  let applied = false;
  store().edit(`Fret ${fret}`, (draft) => {
    applied = E.setNote(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      stringIndex,
      fret,
      entryDuration,
    );
  });
  return applied;
}

/** Toggles a drum piece at the cursor, defaulting to the cursor row's piece. */
export function toggleDrumAtCursor(piece?: DrumPiece): boolean {
  const { cursor, entryDuration } = store();
  const track = currentTrack();
  if (!cursor || !track || !isDrumTrack(track)) return false;

  const target = piece ?? defaultPieceForRow(cursor.line);
  if (!target) return false;

  let applied = false;
  store().edit(`Toggle ${target}`, (draft) => {
    applied = E.toggleDrumNote(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      target,
      entryDuration,
    );
  });
  return applied;
}

/** Deletes the note under the cursor. */
export function deleteAtCursor(): boolean {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return false;

  let applied = false;
  if (isStringTrack(track)) {
    const stringIndex = stringForLine(track, cursor.line);
    store().edit('Delete note', (draft) => {
      applied = E.removeNote(
        draft,
        cursor.trackId,
        cursor.measureIndex,
        cursor.beatIndex,
        stringIndex,
      );
    });
  } else {
    const piece = defaultPieceForRow(cursor.line);
    const beat = track.measures[cursor.measureIndex]?.beats[cursor.beatIndex];
    // On a drum row, delete whichever variant is actually present — the user
    // means "remove what I see", not specifically the row's default piece.
    const present = beat?.notes.find((n) => rowForPiece(n.piece) === cursor.line);
    const target = (present as { piece: DrumPiece } | undefined)?.piece ?? piece;
    if (!target) return false;
    store().edit('Delete drum note', (draft) => {
      applied = E.toggleDrumNote(
        draft,
        cursor.trackId,
        cursor.measureIndex,
        cursor.beatIndex,
        target,
        store().entryDuration,
      );
    });
  }
  return applied;
}

/** Clears every note in the beat under the cursor. */
export function clearBeatAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Clear beat', (draft) => {
    E.clearBeat(draft, cursor.trackId, cursor.measureIndex, cursor.beatIndex);
  });
}

/** Removes the beat entirely, closing the gap. */
export function deleteBeatAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Delete beat', (draft) => {
    E.deleteBeat(draft, cursor.trackId, cursor.measureIndex, cursor.beatIndex);
  });
}

export function toggleTechniqueAtCursor(technique: Parameters<typeof E.toggleTechnique>[5]): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track || !isStringTrack(track)) return;

  const stringIndex = stringForLine(track, cursor.line);
  store().edit(`Toggle ${technique}`, (draft) => {
    E.toggleTechnique(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      stringIndex,
      technique,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Rhythm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sets the entry duration, and retimes the beat under the cursor if it has
 * notes — so picking a duration with a note selected edits that note, while
 * picking one on an empty slot arms the next note. Both readings are natural,
 * and which one applies is obvious from what is on screen.
 */
export function setEntryDuration(duration: Fraction): void {
  const { cursor } = store();
  store().setEntryDuration(duration);

  const track = currentTrack();
  const beat = track?.measures[cursor?.measureIndex ?? -1]?.beats[cursor?.beatIndex ?? -1];
  if (!cursor || !beat || beat.notes.length === 0) return;

  store().edit('Set duration', (draft) => {
    E.setBeatDuration(draft, cursor.trackId, cursor.measureIndex, cursor.beatIndex, duration);
  });
}

export const shortenDuration = (): void => setEntryDuration(D.shorter(store().entryDuration));
export const lengthenDuration = (): void => setEntryDuration(D.longer(store().entryDuration));
export const cycleDots = (): void => setEntryDuration(D.cycleDots(store().entryDuration));
export const toggleTriplet = (): void => setEntryDuration(D.toggleTriplet(store().entryDuration));

/* -------------------------------------------------------------------------- */
/* Measures and tracks                                                        */
/* -------------------------------------------------------------------------- */

export function insertMeasureAtCursor(): void {
  const { cursor } = store();
  store().edit('Insert bar', (draft) => E.insertMeasure(draft, cursor?.measureIndex ?? 0));
}

export function appendMeasure(): void {
  store().edit('Add bar', (draft) => E.appendMeasure(draft));
}

export function deleteMeasureAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Delete bar', (draft) => {
    E.deleteMeasure(draft, cursor.measureIndex);
  });
}

/** Moves the cursor to the next or previous track, keeping the bar position. */
export function stepTrack(delta: number): void {
  const { song, cursor } = store();
  if (!song || !cursor) return;

  const index = song.tracks.findIndex((t) => t.id === cursor.trackId);
  if (index < 0) return;
  const next = song.tracks[(index + delta + song.tracks.length) % song.tracks.length];
  if (!next) return;

  const lineCount = isStringTrack(next) ? next.tuning.length : DRUM_ROW_COUNT;
  store().setCursor({
    trackId: next.id,
    measureIndex: Math.min(cursor.measureIndex, Math.max(0, next.measures.length - 1)),
    beatIndex: 0,
    line: Math.min(cursor.line, lineCount - 1),
  });
}

/* -------------------------------------------------------------------------- */
/* Cursor movement                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Moves one slot right, wrapping into the next bar at the end of the current
 * one — which is what makes typing a run of notes feel continuous rather than
 * stopping dead at every bar line.
 */
export function stepRight(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;

  const measure = track.measures[cursor.measureIndex];
  const lastSlot = measure ? measure.beats.length : 0;

  if (cursor.beatIndex >= lastSlot && cursor.measureIndex < track.measures.length - 1) {
    store().setCursor({ ...cursor, measureIndex: cursor.measureIndex + 1, beatIndex: 0 });
    return;
  }
  store().moveCursor({ beat: 1 });
}

/** Moves one slot left, wrapping back into the previous bar. */
export function stepLeft(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;

  if (cursor.beatIndex === 0 && cursor.measureIndex > 0) {
    const previous = track.measures[cursor.measureIndex - 1];
    store().setCursor({
      ...cursor,
      measureIndex: cursor.measureIndex - 1,
      beatIndex: previous ? previous.beats.length : 0,
    });
    return;
  }
  store().moveCursor({ beat: -1 });
}

export const stepUp = (): void => store().moveCursor({ line: -1 });
export const stepDown = (): void => store().moveCursor({ line: 1 });

export function goToMeasureStart(): void {
  const { cursor } = store();
  if (cursor) store().setCursor({ ...cursor, beatIndex: 0 });
}

export function goToMeasureEnd(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;
  const measure = track.measures[cursor.measureIndex];
  store().setCursor({ ...cursor, beatIndex: measure ? measure.beats.length : 0 });
}

