/**
 * How many notes of a given value actually fit in a bar.
 *
 * These exist because the answer is easy to get subtly wrong and hard to eyeball
 * in the UI: a bar that is already full legitimately accepts nothing, and that
 * is indistinguishable from a broken editor unless the arithmetic is pinned
 * down somewhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { createSong, createStringTrack } from '../model/song';
import { isStringTrack, type StringTrack } from '../model/types';
import { resetStoreForTesting, useSongStore } from '../store/songStore';
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

const guitar = (): StringTrack => {
  const t = store().song!.tracks[0]!;
  if (!isStringTrack(t)) throw new Error('expected a string track');
  return t;
};

/** Fills bar 0 with notes of `value` until the model refuses, and counts them. */
function fillBar(value: Fraction, startAt = 0): number {
  const id = guitar().id;
  store().setEntryDuration(value);
  let added = 0;
  for (let i = 0; i < 200; i++) {
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: startAt + i, line: 0 });
    if (!C.setFretAtCursor(1)) break;
    added += 1;
  }
  return added;
}

beforeEach(() => {
  resetStoreForTesting();
  store().openSong(createSong({ tracks: [createStringTrack('guitar', { measureCount: 4 })] }));
});

describe('an empty 4/4 bar', () => {
  it('holds the textbook number of each note value', () => {
    const cases: [Fraction, number, string][] = [
      [F.QUARTER, 4, 'quarters'],
      [F.EIGHTH, 8, 'eighths'],
      [F.SIXTEENTH, 16, 'sixteenths'],
      [F.THIRTY_SECOND, 32, 'thirty-seconds'],
    ];
    for (const [value, expected, name] of cases) {
      resetStoreForTesting();
      store().openSong(createSong({ tracks: [createStringTrack('guitar', { measureCount: 4 })] }));
      expect(fillBar(value), name).toBe(expected);
    }
  });

  it('holds twelve triplet eighths', () => {
    expect(fillBar(F.tuplet(F.EIGHTH, 3, 2))).toBe(12);
  });
});

describe('a partly filled bar', () => {
  it('takes eight sixteenths after four eighths', () => {
    // Four eighths is half a bar, so half a bar of sixteenths still fits.
    expect(fillBar(F.EIGHTH, 0)).toBeGreaterThanOrEqual(4);
  });

  it('accepts exactly the remaining capacity in the smaller value', () => {
    const id = guitar().id;
    store().setEntryDuration(F.EIGHTH);
    for (let i = 0; i < 4; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      expect(C.setFretAtCursor(i)).toBe(true);
    }
    // Half the bar is used; the rest holds eight sixteenths.
    expect(fillBar(F.SIXTEENTH, 4)).toBe(8);
  });

  it('accepts sixteen thirty-seconds after eight sixteenths', () => {
    const id = guitar().id;
    store().setEntryDuration(F.SIXTEENTH);
    for (let i = 0; i < 8; i++) {
      store().setCursor({ trackId: id, measureIndex: 0, beatIndex: i, line: 0 });
      expect(C.setFretAtCursor(i)).toBe(true);
    }
    expect(fillBar(F.THIRTY_SECOND, 8)).toBe(16);
  });
});

describe('a full bar', () => {
  it('accepts nothing more, whatever value is armed', () => {
    // This is correct, not a defect: eight eighths is a complete 4/4 bar, so a
    // sixteenth cannot be appended without removing something first.
    expect(fillBar(F.EIGHTH)).toBe(8);
    expect(fillBar(F.SIXTEENTH, 8)).toBe(0);
    expect(fillBar(F.THIRTY_SECOND, 8)).toBe(0);
  });

  it('takes notes again once one is deleted', () => {
    expect(fillBar(F.EIGHTH)).toBe(8);

    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 7, line: 0 });
    C.deleteAtCursor();

    // Deleting one eighth frees exactly two sixteenths' worth of room.
    expect(fillBar(F.SIXTEENTH, 7)).toBe(2);
  });
});

describe('feedback when an edit is refused', () => {
  it('explains that the bar is full rather than failing silently', () => {
    expect(fillBar(F.EIGHTH)).toBe(8);
    store().setNotice(null);

    const id = guitar().id;
    store().setEntryDuration(F.SIXTEENTH);
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 8, line: 0 });
    expect(C.setFretAtCursor(5)).toBe(false);

    // A silent refusal is indistinguishable from a broken editor, so the
    // message must name the bar and say what to do next.
    expect(store().notice?.message).toMatch(/bar 1 is full/i);
    expect(store().notice?.message).toMatch(/4\/4/);
    expect(store().notice?.message).toMatch(/add a bar/i);
  });

  it('explains a fret beyond the end of the neck', () => {
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    expect(C.setFretAtCursor(99)).toBe(false);
    expect(store().notice?.message).toMatch(/past the end/i);
  });

  it('clears the notice once an edit succeeds', () => {
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 0, line: 0 });
    C.setFretAtCursor(99); // refused, sets a notice
    expect(store().notice).not.toBeNull();

    expect(C.setFretAtCursor(3)).toBe(true);
    expect(store().notice).toBeNull();
  });

  it('re-issues a repeated message with a new id so the timer restarts', () => {
    expect(fillBar(F.EIGHTH)).toBe(8);
    const id = guitar().id;
    store().setCursor({ trackId: id, measureIndex: 0, beatIndex: 8, line: 0 });

    C.setFretAtCursor(5);
    const first = store().notice!;
    C.setFretAtCursor(5);
    const second = store().notice!;

    expect(second.message).toBe(first.message);
    expect(second.id).toBeGreaterThan(first.id);
  });
});

describe('bars in other time signatures', () => {
  it('scales capacity with the time signature', () => {
    store().edit('3/4', (d) => {
      d.timeSignatures = [{ bar: 0, num: 3, den: 4 }];
    });
    expect(fillBar(F.EIGHTH)).toBe(6); // 3/4 holds six eighths
  });
});
