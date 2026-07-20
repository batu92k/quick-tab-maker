import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../model/fraction';
import { createDrumTrack, createSong, createStringTrack } from '../model/song';
import { isStringTrack, type Song, type StringTrack, type Track } from '../model/types';
import { resetStoreForTesting, useSongStore } from '../store/songStore';
import { rowForPiece } from '../theory/drums';
import * as C from './commands';

vi.mock('../store/persistence', () => ({
  saveSong: vi.fn(async () => undefined),
  createAutosaver: () => ({
    schedule: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
}));

const store = () => useSongStore.getState();

function open(tracks: readonly Track[] = [createStringTrack('guitar', { measureCount: 4 })]): Song {
  const song = createSong({ tracks });
  store().openSong(song);
  return song;
}

const guitar = (): StringTrack => {
  const t = store().song!.tracks[0]!;
  if (!isStringTrack(t)) throw new Error('expected a string track');
  return t;
};

const notesAt = (measure = 0, beat = 0) => guitar().measures[measure]?.beats[beat]?.notes ?? [];

beforeEach(() => {
  resetStoreForTesting();
});

describe('line and string mapping', () => {
  it('inverts between visual line and string index', () => {
    open();
    const track = guitar();
    // Line 0 is the top of the tab, which is the highest string — the last
    // entry in the lowest-first tuning array.
    expect(C.stringForLine(track, 0)).toBe(5);
    expect(C.stringForLine(track, 5)).toBe(0);
    expect(C.lineForString(track, 5)).toBe(0);
    expect(C.lineForString(track, 0)).toBe(5);
  });

  it('round-trips for every line', () => {
    open();
    const track = guitar();
    for (let line = 0; line < track.tuning.length; line++) {
      expect(C.lineForString(track, C.stringForLine(track, line))).toBe(line);
    }
  });

  it('writes a fret to the string the cursor is visually on', () => {
    open();
    // Cursor on the top line should write the highest string, not string 0.
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(3);
    expect(notesAt()[0]).toMatchObject({ string: 5, fret: 3 });
  });
});

describe('fret entry', () => {
  it('places a fret at the cursor', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 5 });
    expect(C.setFretAtCursor(7)).toBe(true);
    expect(notesAt()[0]).toMatchObject({ string: 0, fret: 7 });
  });

  it('uses the armed entry duration', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    store().setEntryDuration(F.SIXTEENTH);
    C.setFretAtCursor(5);
    expect(guitar().measures[0]!.beats[0]!.duration).toEqual(F.SIXTEENTH);
  });

  it('reports refusal when the bar is full, so the caller can stop advancing', () => {
    open();
    const id = guitar().id;
    for (let i = 0; i < 4; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      expect(C.setFretAtCursor(i)).toBe(true);
    }
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 4, line: 0 });
    expect(C.setFretAtCursor(9)).toBe(false);
  });

  it('does nothing on a drum track', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 0 });
    expect(C.setFretAtCursor(3)).toBe(false);
  });
});

describe('drum entry', () => {
  it('places the row default piece', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    const row = rowForPiece('snare');
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: row });

    expect(C.toggleDrumAtCursor()).toBe(true);
    expect(store().song!.tracks[0]!.measures[0]!.beats[0]!.notes[0]).toMatchObject({
      piece: 'snare',
    });
  });

  it('toggles the same piece back off', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    store().setCursor({
      trackId: song.tracks[0]!.id,
      measureIndex: 0,
      beatIndex: 0,
      line: rowForPiece('kick'),
    });
    C.toggleDrumAtCursor();
    C.toggleDrumAtCursor();
    expect(store().song!.tracks[0]!.measures[0]!.beats).toEqual([]);
  });

  it('deletes an open hi-hat from the hi-hat row, not just the default piece', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    const id = song.tracks[0]!.id;
    const row = rowForPiece('hihat');
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: row });

    // An open hi-hat shares the closed hi-hat's row.
    C.toggleDrumAtCursor('hihatOpen');
    expect(store().song!.tracks[0]!.measures[0]!.beats[0]!.notes).toHaveLength(1);

    expect(C.deleteAtCursor()).toBe(true);
    expect(store().song!.tracks[0]!.measures[0]!.beats).toEqual([]);
  });
});

describe('cursor movement', () => {
  it('wraps to the next bar at the end of the current one', () => {
    open();
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(1); // one beat exists, so the append slot is index 1

    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 1, line: 0 });
    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 1, beatIndex: 0 });
  });

  it('wraps back into the previous bar', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 1, beatIndex: 0, line: 0 });
    C.stepLeft();
    expect(store().cursor).toMatchObject({ measureIndex: 0 });
  });

  it('stops at the very start rather than going negative', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.stepLeft();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0 });
  });

  it('jumps to the start and end of a bar', () => {
    open();
    const id = guitar().id;
    for (let i = 0; i < 3; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      C.setFretAtCursor(i);
    }
    C.goToMeasureStart();
    expect(store().cursor!.beatIndex).toBe(0);
    C.goToMeasureEnd();
    expect(store().cursor!.beatIndex).toBe(3); // the append slot
  });

  it('cycles between tracks, clamping the line to the new track', () => {
    const song = open([
      createStringTrack('guitar', { measureCount: 2 }),
      createDrumTrack({ measureCount: 2 }),
      createStringTrack('bass', { measureCount: 2 }),
    ]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 5 });

    C.stepTrack(1);
    expect(store().cursor!.trackId).toBe(song.tracks[1]!.id);

    C.stepTrack(1);
    // A bass has 4 strings, so line 5 must be clamped to 3.
    expect(store().cursor).toMatchObject({ trackId: song.tracks[2]!.id, line: 3 });

    C.stepTrack(1); // wraps back to the first track
    expect(store().cursor!.trackId).toBe(song.tracks[0]!.id);
  });
});

describe('duration commands', () => {
  it('arms the entry duration when the slot is empty', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setEntryDuration(F.EIGHTH);
    expect(store().entryDuration).toEqual(F.EIGHTH);
    expect(guitar().measures[0]!.beats).toEqual([]); // nothing written
  });

  it('never rewrites the note under the cursor', () => {
    // Regression: choosing a note value used to retime whatever beat the cursor
    // happened to be on. Because the cursor always sits on something, picking a
    // value silently rewrote existing music and made bar lengths jump around.
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(3); // written as a quarter

    C.setEntryDuration(F.SIXTEENTH);
    expect(guitar().measures[0]!.beats[0]!.duration).toEqual(F.QUARTER);
    expect(store().entryDuration).toEqual(F.SIXTEENTH);
  });

  it('does not conjure space in a full bar by shrinking an existing note', () => {
    // Regression: on a full bar, choosing a shorter value shrank a note and so
    // allowed exactly one more note to be squeezed in.
    open();
    const id = guitar().id;
    store().setEntryDuration(F.EIGHTH);
    for (let i = 0; i < 8; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      expect(C.setFretAtCursor(i)).toBe(true);
    }

    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setEntryDuration(F.SIXTEENTH);

    // The bar is still exactly full, and nothing more fits.
    expect(guitar().measures[0]!.beats).toHaveLength(8);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 8, line: 0 });
    expect(C.setFretAtCursor(5)).toBe(false);
  });

  it('changes a note value only when explicitly applied', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(3);

    C.setEntryDuration(F.EIGHTH);
    expect(C.canApplyDurationToCursorBeat()).toBe(true);
    expect(C.applyDurationToCursorBeat()).toBe(true);
    expect(guitar().measures[0]!.beats[0]!.duration).toEqual(F.EIGHTH);
  });

  it('will not apply a note value on an empty slot', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    expect(C.canApplyDurationToCursorBeat()).toBe(false);
    expect(C.applyDurationToCursorBeat()).toBe(false);
    expect(store().canUndo()).toBe(false);
  });

  it('refuses to lengthen a note past the end of a full bar', () => {
    open();
    const id = guitar().id;
    store().setEntryDuration(F.QUARTER);
    for (let i = 0; i < 4; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      C.setFretAtCursor(i);
    }

    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setEntryDuration(F.HALF);
    expect(C.applyDurationToCursorBeat()).toBe(false);
    expect(guitar().measures[0]!.beats[0]!.duration).toEqual(F.QUARTER);
  });

  it('fills a bar that has room with as many short notes as fit', () => {
    // The complement of the full-bar case: half a bar of eighths leaves room
    // for eight sixteenths, and every one of them must be enterable.
    open();
    const id = guitar().id;
    store().setEntryDuration(F.EIGHTH);
    for (let i = 0; i < 4; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      C.setFretAtCursor(i);
    }

    store().setEntryDuration(F.SIXTEENTH);
    for (let i = 0; i < 8; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 4 + i, line: 0 });
      expect(C.setFretAtCursor(1)).toBe(true);
    }
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 12, line: 0 });
    expect(C.setFretAtCursor(1)).toBe(false); // now genuinely full
  });

  it('steps the note value shorter and longer', () => {
    open();
    store().setEntryDuration(F.QUARTER);
    C.shortenDuration();
    expect(store().entryDuration).toEqual(F.EIGHTH);
    C.lengthenDuration();
    expect(store().entryDuration).toEqual(F.QUARTER);
  });

  it('applies dots and triplets to the armed value', () => {
    open();
    store().setEntryDuration(F.QUARTER);
    C.cycleDots();
    expect(store().entryDuration).toEqual(F.dotted(F.QUARTER));
    C.cycleDots();
    C.cycleDots(); // back around to undotted
    expect(store().entryDuration).toEqual(F.QUARTER);

    C.toggleTriplet();
    expect(store().entryDuration).toEqual(F.tuplet(F.QUARTER, 3, 2));
  });
});

describe('techniques', () => {
  it('toggles a technique on the note under the cursor', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(5);
    C.toggleTechniqueAtCursor('hammer');
    expect(notesAt()[0]!.techniques).toEqual(['hammer']);

    C.toggleTechniqueAtCursor('hammer');
    expect(notesAt()[0]!.techniques).toEqual([]);
  });

  it('records no history when there is no note to modify', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.toggleTechniqueAtCursor('bend');
    expect(store().canUndo()).toBe(false);
  });
});

describe('structure', () => {
  it('inserts a bar at the cursor', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 1, beatIndex: 0, line: 0 });
    C.insertMeasureAtCursor();
    expect(guitar().measures).toHaveLength(5);
  });

  it('appends and deletes bars', () => {
    open();
    C.appendMeasure();
    expect(guitar().measures).toHaveLength(5);

    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.deleteMeasureAtCursor();
    expect(guitar().measures).toHaveLength(4);
  });
});
