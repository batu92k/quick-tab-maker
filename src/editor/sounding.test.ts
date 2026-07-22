/**
 * Mirroring the cursor's beat onto the fretboard.
 *
 * The one thing worth pinning here is the string inversion: the score numbers
 * lines from the top and the document numbers strings from the lowest pitch, so
 * a mirror that gets it backwards still looks plausible — it just quietly
 * teaches the wrong shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../model/fraction';
import { beatAtOffset, createDrumTrack, createSong, createStringTrack } from '../model/song';
import { isStringTrack, type Cursor, type StringTrack, type Track } from '../model/types';
import { resetStoreForTesting, useSongStore } from '../store/songStore';
import * as C from './commands';
import { fretInput } from './input/events';

vi.mock('../store/persistence', () => ({
  saveSong: vi.fn(async () => undefined),
  createAutosaver: () => ({
    schedule: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
}));

const store = () => useSongStore.getState();

function open(tracks: readonly Track[]): Track {
  store().openSong(createSong({ tracks }));
  return store().song!.tracks[0]!;
}

const guitar = (): StringTrack => {
  const t = store().song!.tracks[0]!;
  if (!isStringTrack(t)) throw new Error('expected a string track');
  return t;
};

/** Builds a three-note shape on beat 0 and returns a cursor pointing at it. */
function chord(): Cursor {
  const track = open([createStringTrack('guitar', { measureCount: 2 })]);
  const at = (line: number): Cursor => ({
    trackId: track.id,
    measureIndex: 0,
    beatIndex: 0,
    line,
  });
  store().setCursor(at(0));
  for (const [string, fret] of [
    [2, 0],
    [3, 2],
    [4, 3],
  ] as const) {
    C.applyNoteInput(fretInput(string, fret));
  }
  return at(0);
}

beforeEach(() => {
  resetStoreForTesting();
});

describe('beatAtOffset', () => {
  /** Four quarters in bar 0, so every boundary is at a round number. */
  function quarters() {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 });
    store().setEntryDuration(F.QUARTER);
    for (let i = 0; i < 4; i++) {
      store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex: i, line: 0 });
      C.applyNoteInput(fretInput(0, i));
    }
    return guitar().measures[0]!;
  }

  it('finds the beat a clock reading falls inside', () => {
    const measure = quarters();
    expect(beatAtOffset(measure, 0.3)).toBe(measure.beats[1]);
    expect(beatAtOffset(measure, 0.6)).toBe(measure.beats[2]);
  });

  it('lands on the beat that starts at a boundary, not the one that ends there', () => {
    const measure = quarters();
    expect(beatAtOffset(measure, 0.25)).toBe(measure.beats[1]);
    expect(beatAtOffset(measure, 0)).toBe(measure.beats[0]);
  });

  it('tolerates a boundary the audio clock lands a hair short of', () => {
    // The playhead reads seconds and converts, so it arrives at 0.25 as
    // 0.2499999999. Snapping backwards there would flicker a beat late.
    const measure = quarters();
    expect(beatAtOffset(measure, 0.25 - 1e-12)).toBe(measure.beats[1]);
  });

  it('has no beat in the empty tail of a partly filled bar', () => {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.applyNoteInput(fretInput(0, 3)); // one quarter in a 4/4 bar
    expect(beatAtOffset(guitar().measures[0]!, 0.9)).toBeUndefined();
  });

  it('has no beat in an empty bar or a missing one', () => {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    expect(beatAtOffset(track.measures[0], 0)).toBeUndefined();
    expect(beatAtOffset(undefined, 0)).toBeUndefined();
  });
});

describe('soundingPositions', () => {
  it('reports every note of the beat, not just the cursor line', () => {
    const cursor = chord();
    const positions = C.soundingPositions(guitar(), cursor);
    expect(positions.map((p) => [p.string, p.fret]).sort()).toEqual([
      [2, 0],
      [3, 2],
      [4, 3],
    ]);
  });

  it('marks the note on the cursor string, inverting line to string index', () => {
    const cursor = chord();
    // Line 1 on a six-string tab is string 4 — the note fretted at 3.
    const positions = C.soundingPositions(guitar(), { ...cursor, line: 1 });
    expect(positions.filter((p) => p.onCursorString).map((p) => p.fret)).toEqual([3]);
  });

  it('marks nothing when the cursor sits on a string with no note', () => {
    // Line 0 is string 5, which is not part of this shape.
    const cursor = chord();
    const positions = C.soundingPositions(guitar(), cursor);
    expect(positions.some((p) => p.onCursorString)).toBe(false);
  });

  it('is empty on an empty beat', () => {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    expect(
      C.soundingPositions(track, { trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 }),
    ).toEqual([]);
  });

  it('is empty past the end of the song', () => {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    expect(
      C.soundingPositions(track, { trackId: track.id, measureIndex: 9, beatIndex: 0, line: 0 }),
    ).toEqual([]);
  });

  it('is empty for a drum track, which shows its beat on the kit instead', () => {
    const track = open([createDrumTrack({ measureCount: 1 })]);
    expect(
      C.soundingPositions(track, { trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 }),
    ).toEqual([]);
  });

  it('emphasises nothing when there is no cursor, as during playback', () => {
    const cursor = chord();
    const beat = guitar().measures[0]!.beats[0];
    // Playback has no "note under the cursor" to pick out of a sounding chord.
    const positions = C.positionsInBeat(guitar(), beat, null);
    expect(positions).toHaveLength(3);
    expect(positions.some((p) => p.onCursorString)).toBe(false);
    // The cursor path still emphasises, so the two modes are genuinely distinct.
    expect(
      C.soundingPositions(guitar(), { ...cursor, line: 1 }).some((p) => p.onCursorString),
    ).toBe(true);
  });

  it('drops a note the instrument cannot reach rather than resolving it', () => {
    const cursor = chord();
    // Callers hand these to stringFretToMidi, which throws out of range, so a
    // note stranded past the end of the neck must not take the panel down.
    const stranded: StringTrack = {
      ...guitar(),
      fretCount: 1,
    };
    expect(C.soundingPositions(stranded, cursor)).toEqual([
      { string: 2, fret: 0, onCursorString: false },
    ]);
  });
});

describe('annotation commands', () => {
  it('adds, edits and removes a note through the real store and Immer', () => {
    // Exercises the command wrappers end to end: a concise arrow that returns
    // an edit op's boolean trips Immer's "returned a value and mutated" guard,
    // and only the real produceWithPatches path catches it.
    const track = open([createStringTrack('guitar', { measureCount: 2 })]);
    store().setCursor({ trackId: track.id, measureIndex: 1, beatIndex: 0, line: 0 });

    const id = C.addAnnotationAtCursor();
    expect(id).toBeTruthy();

    C.editAnnotationText(id!, 'play x2');
    expect(store().song!.annotations).toEqual([{ id, bar: 1, offset: F.ZERO, text: 'play x2' }]);

    C.removeAnnotationIfEmpty(id!); // has text, stays
    expect(store().song!.annotations).toHaveLength(1);

    C.editAnnotationText(id!, '   ');
    C.removeAnnotationIfEmpty(id!); // blank, removed
    expect(store().song!.annotations).toHaveLength(0);
  });
});

describe('insert note between existing notes', () => {
  const at = (track: Track, beatIndex: number): void =>
    store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex, line: 0 });

  it('drops a shorter slot between two notes and shifts the rest right', () => {
    // The reported case: 16th notes, wanting a 32nd in between.
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    store().setEntryDuration(F.SIXTEENTH);
    at(track, 0);
    C.applyNoteInput(fretInput(0, 5));
    at(track, 1);
    C.applyNoteInput(fretInput(0, 7));

    store().setEntryDuration(F.THIRTY_SECOND);
    at(track, 1); // on the second 16th
    expect(C.insertBeatAtCursor()).toBe(true);
    C.applyNoteInput(fretInput(0, 9)); // fill the inserted rest

    const beats = guitar().measures[0]!.beats;
    expect(beats.map((b) => b.notes[0]?.fret)).toEqual([5, 9, 7]);
    expect(beats.map((b) => F.toString(b.duration))).toEqual(['1/16', '1/32', '1/16']);
  });

  it('refuses to insert into a full bar', () => {
    const track = open([createStringTrack('guitar', { measureCount: 1 })]);
    store().setEntryDuration(F.QUARTER);
    for (let i = 0; i < 4; i++) {
      at(track, i);
      C.applyNoteInput(fretInput(0, i));
    }
    at(track, 2);
    expect(C.insertBeatAtCursor()).toBe(false);
    expect(guitar().measures[0]!.beats).toHaveLength(4);
  });
});
