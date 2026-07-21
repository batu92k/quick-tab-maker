/**
 * Mirroring the cursor's beat onto the fretboard.
 *
 * The one thing worth pinning here is the string inversion: the score numbers
 * lines from the top and the document numbers strings from the lowest pitch, so
 * a mirror that gets it backwards still looks plausible — it just quietly
 * teaches the wrong shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrumTrack, createSong, createStringTrack } from '../model/song';
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
