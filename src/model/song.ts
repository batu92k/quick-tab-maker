/**
 * Factories and read-only queries over a song document.
 *
 * Everything here is pure. Mutation lives in `edit.ts`, which operates on Immer
 * drafts; keeping the two apart means the queries can be reused by the
 * renderer, the audio scheduler and the PDF exporter without dragging Immer in.
 */

import * as F from './fraction';
import type { Fraction } from './fraction';
import { newBeatId, newMeasureId, newSongId, newTrackId } from './ids';
import {
  CURRENT_SCHEMA_VERSION,
  isStringTrack,
  type AnyNote,
  type Beat,
  type DrumNote,
  type DrumTrack,
  type Id,
  type Measure,
  type MixerSettings,
  type Note,
  type Song,
  type SongKey,
  type StringTrack,
  type TimeSignature,
  type Track,
} from './types';
import { DEFAULT_BASS_TUNING, DEFAULT_GUITAR_TUNING } from '../theory/midi';

export const DEFAULT_TEMPO = 120;
export const DEFAULT_TIME_SIGNATURE: TimeSignature = { num: 4, den: 4 };
export const DEFAULT_KEY: SongKey = { tonic: 'C', mode: 'major' };
export const DEFAULT_MEASURE_COUNT = 8;

const DEFAULT_MIXER: MixerSettings = { volume: 0.8, pan: 0, muted: false, solo: false };

/* -------------------------------------------------------------------------- */
/* Factories                                                                  */
/* -------------------------------------------------------------------------- */

export function createBeat<N extends AnyNote>(
  start: Fraction,
  duration: Fraction,
  notes: readonly N[] = [],
): Beat<N> {
  return { id: newBeatId(), start, duration, notes };
}

/** An empty measure — no beats at all, which renders as a whole-bar rest. */
export function createMeasure<N extends AnyNote>(timeSig?: TimeSignature): Measure<N> {
  return timeSig ? { id: newMeasureId(), beats: [], timeSig } : { id: newMeasureId(), beats: [] };
}

function emptyMeasures<N extends AnyNote>(count: number): Measure<N>[] {
  return Array.from({ length: count }, () => createMeasure<N>());
}

export function createStringTrack(
  kind: 'guitar' | 'bass',
  options: {
    name?: string;
    tuning?: readonly string[];
    fretCount?: number;
    measureCount?: number;
  } = {},
): StringTrack {
  const isBass = kind === 'bass';
  return {
    id: newTrackId(),
    kind,
    name: options.name ?? (isBass ? 'Bass' : 'Guitar'),
    tuning: options.tuning ?? (isBass ? DEFAULT_BASS_TUNING : DEFAULT_GUITAR_TUNING),
    fretCount: options.fretCount ?? (isBass ? 24 : 24),
    capo: 0,
    instrumentId: isBass ? 'bass-pluck' : 'guitar-pluck',
    mixer: DEFAULT_MIXER,
    measures: emptyMeasures<Note>(options.measureCount ?? DEFAULT_MEASURE_COUNT),
  };
}

export function createDrumTrack(options: { name?: string; measureCount?: number } = {}): DrumTrack {
  return {
    id: newTrackId(),
    kind: 'drums',
    name: options.name ?? 'Drums',
    kitId: 'standard',
    instrumentId: 'drum-synth',
    mixer: DEFAULT_MIXER,
    measures: emptyMeasures<DrumNote>(options.measureCount ?? DEFAULT_MEASURE_COUNT),
  };
}

export function createSong(
  options: {
    title?: string;
    artist?: string;
    tempo?: number;
    key?: SongKey;
    timeSig?: TimeSignature;
    tracks?: readonly Track[];
  } = {},
): Song {
  const now = new Date().toISOString();
  const timeSig = options.timeSig ?? DEFAULT_TIME_SIGNATURE;
  return {
    id: newSongId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    title: options.title ?? 'Untitled Song',
    artist: options.artist ?? '',
    createdAt: now,
    updatedAt: now,
    tempoMap: [{ bar: 0, bpm: options.tempo ?? DEFAULT_TEMPO }],
    timeSignatures: [{ bar: 0, num: timeSig.num, den: timeSig.den }],
    key: options.key ?? DEFAULT_KEY,
    tracks: options.tracks ?? [createStringTrack('guitar')],
    annotations: [],
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

export function findTrack(song: Song, trackId: Id): Track | undefined {
  return song.tracks.find((t) => t.id === trackId);
}

export function trackIndex(song: Song, trackId: Id): number {
  return song.tracks.findIndex((t) => t.id === trackId);
}

/**
 * The time signature in force at `bar`.
 *
 * Markers are sorted by bar and the list always starts at bar 0, so this is the
 * last marker at or before the bar. Linear scan is deliberate: songs have a
 * handful of signature changes, and a binary search would be harder to read for
 * no measurable gain.
 */
export function timeSignatureAt(song: Song, bar: number): TimeSignature {
  let current: TimeSignature = DEFAULT_TIME_SIGNATURE;
  for (const marker of song.timeSignatures) {
    if (marker.bar > bar) break;
    current = { num: marker.num, den: marker.den };
  }
  return current;
}

/** The tempo in force at `bar`, in BPM. */
export function tempoAt(song: Song, bar: number): number {
  let current = DEFAULT_TEMPO;
  for (const marker of song.tempoMap) {
    if (marker.bar > bar) break;
    current = marker.bpm;
  }
  return current;
}

/**
 * How much musical time a measure holds, honouring a per-measure override.
 *
 * A measure may carry its own `timeSig`, which both applies to it and becomes
 * the prevailing signature from that bar on; the song-level marker list is kept
 * in sync by `edit.ts` so this and `timeSignatureAt` never disagree.
 */
export function measureCapacity(song: Song, track: Track, measureIndex: number): Fraction {
  const override = track.measures[measureIndex]?.timeSig;
  const sig = override ?? timeSignatureAt(song, measureIndex);
  return F.measureDuration(sig.num, sig.den);
}

/**
 * Total musical time used by a measure's beats. May be less than capacity.
 *
 * Typed structurally rather than as `Measure<N>` so it accepts a measure from
 * either kind of track: how full a bar is has nothing to do with what sort of
 * notes are in it, and the generic version cannot take the union.
 */
export function measureFilled(measure: {
  readonly beats: readonly { readonly start: Fraction; readonly duration: Fraction }[];
}): Fraction {
  return measure.beats.reduce((acc, beat) => F.max(acc, F.add(beat.start, beat.duration)), F.ZERO);
}

/** The longest measure list across all tracks — the song's length in bars. */
export function songLengthInBars(song: Song): number {
  return song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
}

/** Absolute start of a bar from the top of the song, in whole notes. */
export function barStart(song: Song, bar: number): Fraction {
  let total = F.ZERO;
  for (let i = 0; i < bar; i++) {
    const sig = timeSignatureAt(song, i);
    total = F.add(total, F.measureDuration(sig.num, sig.den));
  }
  return total;
}

/** Number of strings, or drum-piece rows, the cursor can move between. */
export function trackLineCount(track: Track, drumRowCount: number): number {
  return isStringTrack(track) ? track.tuning.length : drumRowCount;
}

/**
 * How many notes a retune to `stringCount` strings would delete — every note
 * sitting on a string index the shorter tuning no longer has. Lets the UI warn
 * before a retune drops notes; `setTuning` does the actual dropping.
 */
export function notesOnStringsBeyond(track: StringTrack, stringCount: number): number {
  let count = 0;
  for (const measure of track.measures) {
    for (const beat of measure.beats) {
      for (const note of beat.notes) {
        if (note.string >= stringCount) count += 1;
      }
    }
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Beat lookup                                                                */
/* -------------------------------------------------------------------------- */

/** The beat covering `position` within a measure, if any. */
export function beatAt<N extends AnyNote>(
  measure: Measure<N>,
  position: Fraction,
): Beat<N> | undefined {
  return measure.beats.find(
    (b) => F.lte(b.start, position) && F.lt(position, F.add(b.start, b.duration)),
  );
}

/**
 * The beat sounding at a *clock* position within a measure.
 *
 * Takes a float rather than a `Fraction` because the caller is the playhead,
 * and a reading off the audio clock genuinely lands between beats — converting
 * it to an exact rational would invent a precision it does not have. This is
 * the one place a float position is legitimate, and it is read-only: nothing
 * here can reach the document.
 */
export function beatAtOffset(
  // Structural rather than `Measure<N>`, like `measureFilled` above: which beat
  // is sounding has nothing to do with what sort of notes are in it, and the
  // generic form cannot take a measure from either kind of track.
  measure: { readonly beats: readonly Beat[] } | undefined,
  offset: number,
): Beat | undefined {
  if (!measure) return undefined;
  // Nudged forward by a hair before comparing, so a reading that arrives at a
  // boundary as 0.2499999999 lands on the beat starting there. Relaxing only
  // the lower edge would not do it: the previous beat's upper edge still
  // contains that sample, and it is found first.
  const at = offset + 1e-9;
  return measure.beats.find((b) => {
    const start = F.toNumber(b.start);
    return at >= start && at < start + F.toNumber(b.duration);
  });
}

/** Index of the beat starting exactly at `position`, or -1. */
export function beatIndexAtStart<N extends AnyNote>(
  measure: Measure<N>,
  position: Fraction,
): number {
  return measure.beats.findIndex((b) => F.eq(b.start, position));
}

/**
 * Snaps a raw bar position (a float, from a pointer) to the nearest grid point,
 * returned as an *exact* fraction because this one may become a stored note
 * position — unlike the playhead's snap, which only ever seeks.
 *
 * The grid is the subdivision lines *and* the actual note onsets, so a click
 * lands on a note when it is near one and on a subdivision line otherwise —
 * the same magnetism the playhead uses, so where you click and where a note
 * lands agree. The bar's end is included so a click past the last note snaps to
 * the append position rather than nowhere.
 */
export function snapPositionInMeasure(
  beats: readonly { readonly start: Fraction }[],
  capacity: Fraction,
  subdivision: Fraction,
  rawOffset: number,
): Fraction {
  const candidates: Fraction[] = [capacity];
  for (let k = 0; ; k++) {
    const line = F.scale(subdivision, k);
    if (F.gte(line, capacity)) break;
    candidates.push(line);
  }
  for (const beat of beats) candidates.push(beat.start);

  let best = candidates[0]!;
  let bestDist = Math.abs(F.toNumber(best) - rawOffset);
  for (const candidate of candidates) {
    const dist = Math.abs(F.toNumber(candidate) - rawOffset);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * The stepping grid for keyboard navigation within a bar: every subdivision
 * line up to (but not including) the bar's capacity, plus every existing
 * beat onset — even an off-grid one, so nothing a note already occupies
 * becomes unreachable. Sorted ascending and de-duplicated by value.
 *
 * The bar end itself is deliberately excluded; crossing into the next bar is
 * the caller's job once `nextGridStop` runs out of stops.
 */
export function gridStops<N extends AnyNote>(
  measure: Measure<N>,
  capacity: Fraction,
  snap: Fraction,
): Fraction[] {
  const stops: Fraction[] = [];
  for (let k = 0; ; k++) {
    const line = F.scale(snap, k);
    if (!F.lt(line, capacity)) break;
    stops.push(line);
  }
  for (const beat of measure.beats) stops.push(beat.start);

  stops.sort(F.cmp);
  const deduped: Fraction[] = [];
  for (const stop of stops) {
    if (deduped.length === 0 || !F.eq(deduped[deduped.length - 1]!, stop)) {
      deduped.push(stop);
    }
  }
  return deduped;
}

/**
 * The nearest stop strictly beyond `current` in the direction of travel:
 * forward (`dir > 0`) or backward (`dir < 0`). `null` means there is no such
 * stop — the caller's signal to cross into the neighbouring bar.
 */
export function nextGridStop(stops: readonly Fraction[], current: Fraction, dir: number): Fraction | null {
  if (dir > 0) {
    for (const stop of stops) {
      if (F.gt(stop, current)) return stop;
    }
    return null;
  }
  for (let i = stops.length - 1; i >= 0; i--) {
    const stop = stops[i]!;
    if (F.lt(stop, current)) return stop;
  }
  return null;
}

/**
 * Resolves a bar offset to cursor coordinates, mirroring `ScoreView`'s click
 * resolver: an offset that lands exactly on a beat's start addresses that
 * beat directly, and anything else — a snap-grid line or note onset that
 * currently has nothing there — becomes an insert position past the last
 * beat, the same shape note entry already expects.
 */
export function resolveOffsetToCursorParts<N extends AnyNote>(
  measure: Measure<N>,
  offset: Fraction,
): { beatIndex: number; insertAt?: Fraction } {
  const onset = beatIndexAtStart(measure, offset);
  if (onset >= 0) return { beatIndex: onset };
  return { beatIndex: measure.beats.length, insertAt: offset };
}

/**
 * Recomputes each beat's `start` so beats sit back-to-back from zero.
 *
 * Tab entry is sequential — a user types notes left to right and changes a
 * duration in the middle — so the common case is "re-flow the bar", not
 * "position this beat absolutely". Callers use this after any structural edit.
 */
export function reflow<N extends AnyNote>(beats: readonly Beat<N>[]): Beat<N>[] {
  let cursor = F.ZERO;
  return beats.map((beat) => {
    const positioned = F.eq(beat.start, cursor) ? beat : { ...beat, start: cursor };
    cursor = F.add(cursor, beat.duration);
    return positioned;
  });
}
