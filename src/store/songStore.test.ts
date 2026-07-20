import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as E from '../model/edit';
import * as F from '../model/fraction';
import { createDrumTrack, createSong, createStringTrack } from '../model/song';
import { isStringTrack, type Song } from '../model/types';
import { resetStoreForTesting, useSongStore } from './songStore';

// IndexedDB does not exist in the node test environment, and these tests are
// about history semantics rather than storage. The persistence layer has its
// own contract and is exercised in the browser.
vi.mock('./persistence', () => ({
  saveSong: vi.fn(async () => undefined),
  createAutosaver: () => ({
    schedule: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
}));

const store = () => useSongStore.getState();

function openTestSong(): Song {
  const song = createSong({
    tracks: [createStringTrack('guitar', { measureCount: 4 }), createDrumTrack({ measureCount: 4 })],
  });
  store().openSong(song);
  return song;
}

/** First note of the first bar of the guitar track, if there is one. */
function firstNote() {
  const track = store().song!.tracks[0]!;
  if (!isStringTrack(track)) throw new Error('expected a string track');
  return track.measures[0]!.beats[0]?.notes[0];
}

const placeNote = (fret: number, beatIndex = 0) =>
  store().edit(`Set fret ${fret}`, (d) => {
    E.setNote(d, d.tracks[0]!.id, 0, beatIndex, 0, fret, F.QUARTER);
  });

beforeEach(() => {
  resetStoreForTesting();
});

describe('opening songs', () => {
  it('places the cursor on the first track', () => {
    const song = openTestSong();
    expect(store().cursor).toEqual({
      trackId: song.tracks[0]!.id,
      measureIndex: 0,
      beatIndex: 0,
      line: 0,
    });
  });

  it('clears history so undo cannot cross into a previous document', () => {
    openTestSong();
    placeNote(3);
    expect(store().canUndo()).toBe(true);

    openTestSong();
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
  });

  it('ignores edits when no song is open', () => {
    expect(() => placeNote(3)).not.toThrow();
    expect(store().song).toBeNull();
  });
});

describe('undo and redo', () => {
  it('reverses an edit', () => {
    openTestSong();
    placeNote(3);
    expect(firstNote()?.fret).toBe(3);

    store().undo();
    expect(firstNote()).toBeUndefined();

    store().redo();
    expect(firstNote()?.fret).toBe(3);
  });

  it('walks back through several edits in order', () => {
    openTestSong();
    placeNote(1, 0);
    placeNote(2, 1);
    placeNote(3, 2);

    store().undo();
    store().undo();
    const track = store().song!.tracks[0]!;
    expect(isStringTrack(track) && track.measures[0]!.beats).toHaveLength(1);
    expect(firstNote()?.fret).toBe(1);
  });

  it('discards the redo branch once a new edit is made', () => {
    openTestSong();
    placeNote(3);
    store().undo();
    expect(store().canRedo()).toBe(true);

    placeNote(7);
    expect(store().canRedo()).toBe(false);
    expect(firstNote()?.fret).toBe(7);
  });

  it('does nothing when there is nothing to undo or redo', () => {
    openTestSong();
    const before = store().song;
    store().undo();
    store().redo();
    expect(store().song).toBe(before);
  });

  it('records no history for an operation that declined to apply', () => {
    openTestSong();
    // Fret 999 is out of range, so setNote returns false without mutating.
    store().edit('Impossible', (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 999, F.QUARTER);
    });
    // Undo must not become available for an edit that never happened.
    expect(store().canUndo()).toBe(false);
  });

  it('restores exact fractions through an undo cycle', () => {
    openTestSong();
    const triplet = F.tuplet(F.EIGHTH, 3, 2);
    store().edit('Triplet', (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 5, triplet);
    });
    store().undo();
    store().redo();

    const track = store().song!.tracks[0]!;
    if (!isStringTrack(track)) throw new Error('expected a string track');
    expect(track.measures[0]!.beats[0]!.duration).toEqual(triplet);
  });

  it('round-trips a structural edit that touches every track', () => {
    const song = openTestSong();
    const before = song.tracks.map((t) => t.measures.length);

    store().edit('Insert bar', (d) => E.insertMeasure(d, 1));
    expect(store().song!.tracks.map((t) => t.measures.length)).toEqual([5, 5]);

    store().undo();
    expect(store().song!.tracks.map((t) => t.measures.length)).toEqual(before);
  });

  it('bounds the history so a long session cannot grow without limit', () => {
    openTestSong();
    // More edits than the limit; each one lands on a distinct bar/beat so they
    // all produce real patches.
    for (let i = 0; i < 260; i++) {
      const measure = Math.floor(i / 4) % 4;
      store().edit(`edit ${i}`, (d) => {
        E.setNote(d, d.tracks[0]!.id, measure, i % 4, 0, i % 12, F.QUARTER);
      });
    }
    expect(store().past.length).toBeLessThanOrEqual(200);
    expect(store().canUndo()).toBe(true);
  });

  it('clears history on request', () => {
    openTestSong();
    placeNote(3);
    store().clearHistory();
    expect(store().canUndo()).toBe(false);
    expect(store().canRedo()).toBe(false);
    // The document itself is untouched.
    expect(firstNote()?.fret).toBe(3);
  });
});

describe('cursor', () => {
  it('moves within the track bounds', () => {
    openTestSong();
    store().moveCursor({ measure: 1, line: 2 });
    expect(store().cursor).toMatchObject({ measureIndex: 1, line: 2 });
  });

  it('clamps rather than running off the ends', () => {
    openTestSong();
    store().moveCursor({ measure: -5, line: -5 });
    expect(store().cursor).toMatchObject({ measureIndex: 0, line: 0 });

    store().moveCursor({ measure: 99, line: 99 });
    expect(store().cursor).toMatchObject({ measureIndex: 3, line: 5 }); // 4 bars, 6 strings
  });

  it('allows one slot past the last beat, where the next note is appended', () => {
    openTestSong();
    placeNote(3, 0); // one beat now exists
    store().moveCursor({ beat: 5 });
    expect(store().cursor!.beatIndex).toBe(1);
  });

  it('survives an undo that removes the beat it sits on', () => {
    openTestSong();
    placeNote(3, 0);
    store().moveCursor({ beat: 1 });
    store().undo();
    // The cursor is not auto-corrected, but moving it re-clamps to the now
    // shorter bar rather than leaving it stranded.
    store().moveCursor({ beat: 0 });
    expect(store().cursor!.beatIndex).toBe(0);
  });
});

describe('entry duration', () => {
  it('is applied to newly entered notes', () => {
    openTestSong();
    store().setEntryDuration(F.EIGHTH);
    store().edit('Eighth', (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, store().entryDuration);
    });
    const track = store().song!.tracks[0]!;
    if (!isStringTrack(track)) throw new Error('expected a string track');
    expect(track.measures[0]!.beats[0]!.duration).toEqual(F.EIGHTH);
  });
});

describe('duplicateSong', () => {
  it('produces an independent copy with a new id', () => {
    const song = openTestSong();
    placeNote(3);
    const copy = store().duplicateSong()!;

    expect(copy.id).not.toBe(song.id);
    expect(copy.title).toBe(`${song.title} (copy)`);
    // Editing the original must not reach into the copy.
    placeNote(9);
    const copiedTrack = copy.tracks[0]!;
    expect(isStringTrack(copiedTrack) && copiedTrack.measures[0]!.beats[0]!.notes[0]!.fret).toBe(3);
  });
});
