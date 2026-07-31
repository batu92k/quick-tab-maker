import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../model/fraction';
import { createDrumTrack, createSong, createStringTrack } from '../model/song';
import { isStringTrack, type Song, type StringTrack, type Track } from '../model/types';
import { resetPlaybackForTesting, usePlaybackStore } from '../store/playbackStore';
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
  // The playback store's default snap is an eighth note (see playbackStore.ts),
  // not "Off" — reset it too so every test starts from a known snap, and tests
  // exercising snap-aware stepping do not depend on run order.
  resetPlaybackForTesting();
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
  it('wraps to the next bar at the end of the current one (snap off)', () => {
    open();
    usePlaybackStore.getState().setSnap(null);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(1); // one beat exists, so the append slot is index 1

    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 1, line: 0 });
    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 1, beatIndex: 0 });
  });

  it('wraps back into the previous bar (snap off)', () => {
    open();
    usePlaybackStore.getState().setSnap(null);
    store().setCursor({ trackId: guitar().id, measureIndex: 1, beatIndex: 0, line: 0 });
    C.stepLeft();
    expect(store().cursor).toMatchObject({ measureIndex: 0 });
  });

  it('stops at the very start rather than going negative (snap off)', () => {
    open();
    usePlaybackStore.getState().setSnap(null);
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

describe('snap-aware cursor movement', () => {
  it('steps to the next empty grid slot in an otherwise empty bar', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });

    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0, insertAt: F.EIGHTH });
  });

  it('lands exactly on an existing on-grid note rather than an insert slot', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;

    // A note at offset 0 and another at offset 1/4 (two eighths), leaving the
    // eighth in between empty.
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(0);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 1, line: 0, insertAt: F.QUARTER });
    C.setFretAtCursor(2);

    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.stepRight();
    // Two notes now exist (offsets 0 and 1/4), so the append-past-the-end
    // insert slot is index 2.
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 2, insertAt: F.EIGHTH });

    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 1 });
    expect(store().cursor!.insertAt).toBeUndefined();
  });

  it('crosses into the next bar, landing on its first grid stop, once the current bar runs out', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0, insertAt: F.scale(F.EIGHTH, 7) });

    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 1, beatIndex: 0 });
    expect(store().cursor!.insertAt).toEqual(F.ZERO);
  });

  it('crosses back into the previous bar, landing on its last grid stop', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 1, beatIndex: 0, line: 0 });

    C.stepLeft();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0 });
    expect(store().cursor!.insertAt).toEqual(F.scale(F.EIGHTH, 7));
  });

  it('stays put at the last stop of the song\'s final bar', () => {
    const song = open([createStringTrack('guitar', { measureCount: 1 })]);
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = song.tracks[0]!.id;
    const last = F.scale(F.EIGHTH, 7);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0, insertAt: last });

    C.stepRight();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0 });
    expect(store().cursor!.insertAt).toEqual(last);
  });

  it('stays put at the very start of the song', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });

    C.stepLeft();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0 });
    expect(store().cursor!.insertAt).toBeUndefined();
  });

  it('keeps the empty-slot position when moving up/down between strings', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    // Sit on an empty grid slot (the second eighth of an otherwise empty bar).
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.stepRight();
    expect(store().cursor).toMatchObject({ beatIndex: 0, line: 0, insertAt: F.EIGHTH });

    // Moving to another string must stay in the same beat, keeping insertAt.
    C.stepDown();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0, line: 1, insertAt: F.EIGHTH });

    C.stepUp();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0, line: 0, insertAt: F.EIGHTH });
  });
});

describe('changing snap', () => {
  it('re-aligns the cursor to the nearest quarter stop when snap coarsens', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    // 5/16: closer to the 1/4 line at 0.25 than to 0 or 0.5.
    const midEighth = F.add(F.QUARTER, F.SIXTEENTH);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0, insertAt: midEighth });

    C.setSnap(F.QUARTER);
    expect(usePlaybackStore.getState().snap).toEqual(F.QUARTER);
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0, insertAt: F.QUARTER });
  });

  it('leaves the cursor untouched when snap is turned off', () => {
    open();
    usePlaybackStore.getState().setSnap(F.EIGHTH);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0, insertAt: F.EIGHTH });

    C.setSnap(null);
    expect(usePlaybackStore.getState().snap).toBeNull();
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 0, insertAt: F.EIGHTH });
  });

  it('keeps the cursor on an existing off-grid note when the new grid still includes its onset', () => {
    open();
    const id = guitar().id;
    store().setEntryDuration(F.EIGHTH);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(0); // beat 0: start 0, duration 1/8
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 1, line: 0 });
    C.setFretAtCursor(1); // beat 1: start 1/8, duration 1/8

    // Sit exactly on the second note (an eighth-note onset), then coarsen to
    // quarter snap — the onset is still a valid stop even though it is not on
    // the quarter grid.
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 1, line: 0 });
    C.setSnap(F.QUARTER);
    expect(store().cursor).toMatchObject({ measureIndex: 0, beatIndex: 1 });
    expect(store().cursor!.insertAt).toBeUndefined();
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

  it('duplicates the cursor bar, growing the track by one', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 1, beatIndex: 0, line: 0 });
    C.duplicateMeasureAtCursor();
    expect(guitar().measures).toHaveLength(5);
  });

  it('moves the cursor onto the new copy', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 1, beatIndex: 2, line: 3 });
    C.duplicateMeasureAtCursor();
    expect(store().cursor).toMatchObject({
      trackId: guitar().id,
      measureIndex: 2,
      beatIndex: 0,
      line: 3,
    });
  });
});

describe('text annotations', () => {
  it('anchors a note at an empty spot to the cursor position, not the downbeat', () => {
    open();
    // Cursor on a gap: no beat at this index, position carried in insertAt.
    store().setCursor({
      trackId: guitar().id,
      measureIndex: 0,
      beatIndex: 0,
      line: 0,
      insertAt: F.QUARTER,
    });
    const id = C.addAnnotationAtCursor();
    const annotation = store().song!.annotations.find((a) => a.id === id);
    expect(annotation).toBeDefined();
    expect(F.eq(annotation!.offset, F.QUARTER)).toBe(true);
  });

  it('anchors to the beat under the cursor when it sits on a note', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(3);
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    const id = C.addAnnotationAtCursor();
    const annotation = store().song!.annotations.find((a) => a.id === id);
    expect(F.eq(annotation!.offset, guitar().measures[0]!.beats[0]!.start)).toBe(true);
  });
});

describe('instrument add/remove', () => {
  it('adds an instrument and shows it', () => {
    open([createStringTrack('guitar', { measureCount: 2 })]);
    C.addInstrument('drums');
    const s = store().song!;
    expect(s.tracks).toHaveLength(2);
    expect(s.tracks[1]!.kind).toBe('drums');
    expect(store().cursor!.trackId).toBe(s.tracks[1]!.id);
  });

  it('removes the shown instrument and moves to a survivor', () => {
    const song = open([
      createStringTrack('guitar', { measureCount: 2 }),
      createDrumTrack({ measureCount: 2 }),
    ]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.removeInstrument(song.tracks[0]!.id);
    const s = store().song!;
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]!.kind).toBe('drums');
    expect(store().cursor!.trackId).toBe(s.tracks[0]!.id);
  });

  it('clears the cursor when the last instrument is removed', () => {
    const song = open([createStringTrack('guitar', { measureCount: 2 })]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.removeInstrument(song.tracks[0]!.id);
    expect(store().song!.tracks).toHaveLength(0);
    expect(store().cursor).toBeNull();
  });
});

describe('setTuning', () => {
  it('changes the track tuning', () => {
    open();
    const id = guitar().id;
    const newTuning = ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'];
    C.setTuning(id, newTuning);
    expect(guitar().tuning).toEqual(newTuning);
  });

  it('records an undo history entry', () => {
    open();
    const id = guitar().id;
    const before = store().past.length;
    C.setTuning(id, ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(store().past.length).toBe(before + 1);
  });

  it('drops notes stranded on strings the new tuning removes', () => {
    open();
    const id = guitar().id;
    // Line 0 is the top line, which maps to the highest string index (5).
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(3);
    expect(notesAt()[0]).toMatchObject({ string: 5, fret: 3 });

    C.setTuning(id, ['E2', 'A2', 'D3', 'G3']); // 4-string tuning drops string 5
    expect(notesAt()).toEqual([]);
  });
});
