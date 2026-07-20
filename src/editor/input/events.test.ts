/**
 * Input routing.
 *
 * These cover the seam that keeps MIDI a later addition rather than a rewrite:
 * every device produces a `NoteInputEvent`, and `applyNoteInput` is the only
 * thing that knows how to turn one into an edit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../model/fraction';
import { createDrumTrack, createSong, createStringTrack } from '../../model/song';
import { isStringTrack, type StringTrack, type Track } from '../../model/types';
import { resetStoreForTesting, useSongStore } from '../../store/songStore';
import { rowForPiece } from '../../theory/drums';
import { pitchToMidi, TUNINGS } from '../../theory/midi';
import * as C from '../commands';
import { drumInput, fretInput, pitchInput } from './events';
import { drumPieceForKey, DRUM_KEYS, keyForDrumPiece } from './drumKeys';

vi.mock('../../store/persistence', () => ({
  saveSong: vi.fn(async () => undefined),
  createAutosaver: () => ({
    schedule: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }),
}));

const store = () => useSongStore.getState();

function open(tracks: readonly Track[] = [createStringTrack('guitar', { measureCount: 4 })]) {
  const song = createSong({ tracks });
  store().openSong(song);
  return song;
}

const guitar = (): StringTrack => {
  const t = store().song!.tracks[0]!;
  if (!isStringTrack(t)) throw new Error('expected a string track');
  return t;
};

const notesAt = (beat = 0) => guitar().measures[0]?.beats[beat]?.notes ?? [];

beforeEach(() => {
  resetStoreForTesting();
});

describe('fret input', () => {
  it('writes to the string named by the event, not the cursor line', () => {
    open();
    // Cursor is on the top line (highest string); the event names string 0.
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });

    expect(C.applyNoteInput(fretInput(0, 5))).toBe(true);
    expect(notesAt()[0]).toMatchObject({ string: 0, fret: 5 });
  });

  it('moves the cursor onto the string it wrote', () => {
    open();
    const track = guitar();
    store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 });

    C.applyNoteInput(fretInput(0, 3));
    // String 0 is the bottom line of a six-string tab.
    expect(store().cursor!.line).toBe(5);
  });

  it('uses the armed entry duration', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    store().setEntryDuration(F.SIXTEENTH);

    C.applyNoteInput(fretInput(2, 7));
    expect(guitar().measures[0]!.beats[0]!.duration).toEqual(F.SIXTEENTH);
  });

  it('is ignored on a drum track', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 0 });
    expect(C.applyNoteInput(fretInput(0, 3))).toBe(false);
  });
});

describe('pitch input', () => {
  it('resolves a pitch to a playable position', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });

    // A2 = MIDI 45, playable as the open A string or the 5th fret of low E.
    expect(C.applyNoteInput(pitchInput(pitchToMidi('A2')))).toBe(true);
    const note = notesAt()[0]!;
    const openA = { string: 1, fret: 0 };
    const fifthFretE = { string: 0, fret: 5 };
    expect([openA, fifthFretE]).toContainEqual({ string: note.string, fret: note.fret });
  });

  it('prefers a position on the string the cursor is already on', () => {
    open();
    const track = guitar();
    // Put the cursor on the low E string, where A2 is the 5th fret.
    store().setCursor({
      trackId: track.id,
      measureIndex: 0,
      beatIndex: 0,
      line: C.lineForString(track, 0),
    });

    C.applyNoteInput(pitchInput(pitchToMidi('A2')));
    // Staying on the current string keeps a played phrase in one hand position
    // instead of jumping across the neck.
    expect(notesAt()[0]).toMatchObject({ string: 0, fret: 5 });
  });

  it('explains a pitch outside the instrument range instead of failing silently', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });

    expect(C.applyNoteInput(pitchInput(20))).toBe(false); // far below a guitar
    expect(store().notice?.message).toMatch(/cannot be played/i);
  });

  it('respects an alternate tuning when resolving', () => {
    open([createStringTrack('bass', { tuning: TUNINGS.bass.standard, measureCount: 2 })]);
    const track = store().song!.tracks[0]!;
    store().setCursor({ trackId: track.id, measureIndex: 0, beatIndex: 0, line: 0 });

    // E1 = MIDI 28 is the open low string of a standard bass.
    expect(C.applyNoteInput(pitchInput(pitchToMidi('E1')))).toBe(true);
    const t = store().song!.tracks[0]!;
    if (!isStringTrack(t)) throw new Error('expected a string track');
    expect(t.measures[0]!.beats[0]!.notes[0]).toMatchObject({ string: 0, fret: 0 });
  });
});

describe('drum input', () => {
  it('places the named piece regardless of the cursor row', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    // Cursor on the crash row, but the event names the kick.
    store().setCursor({
      trackId: song.tracks[0]!.id,
      measureIndex: 0,
      beatIndex: 0,
      line: rowForPiece('crash'),
    });

    expect(C.applyNoteInput(drumInput('kick'))).toBe(true);
    expect(store().song!.tracks[0]!.measures[0]!.beats[0]!.notes[0]).toMatchObject({
      piece: 'kick',
    });
  });

  it('layers several pieces on one beat', () => {
    const song = open([createDrumTrack({ measureCount: 2 })]);
    store().setCursor({ trackId: song.tracks[0]!.id, measureIndex: 0, beatIndex: 0, line: 0 });

    C.applyNoteInput(drumInput('kick'));
    C.applyNoteInput(drumInput('hihat'));
    expect(store().song!.tracks[0]!.measures[0]!.beats[0]!.notes).toHaveLength(2);
  });

  it('is ignored on a string track', () => {
    open();
    store().setCursor({ trackId: guitar().id, measureIndex: 0, beatIndex: 0, line: 0 });
    expect(C.applyNoteInput(drumInput('kick'))).toBe(false);
  });
});

describe('drum key map', () => {
  it('maps keys to pieces and back', () => {
    for (const binding of DRUM_KEYS) {
      expect(drumPieceForKey(binding.key)).toBe(binding.piece);
      expect(keyForDrumPiece(binding.piece)).toBe(binding.key);
    }
  });

  it('is case insensitive', () => {
    expect(drumPieceForKey('V')).toBe('kick');
  });

  it('assigns each key to exactly one piece', () => {
    const keys = DRUM_KEYS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only reuses letters that are string-only technique shortcuts', async () => {
    // Drum keys deliberately overlap technique keys. That is safe only while
    // every colliding technique binding is marked stringOnly, so the two sets
    // can never be live at the same time.
    const { KEY_BINDINGS } = await import('../keymap');
    const drumKeys = new Set(DRUM_KEYS.map((b) => b.key));
    for (const binding of KEY_BINDINGS) {
      if (drumKeys.has(binding.key)) {
        expect(binding.stringOnly, `binding "${binding.key}" collides with a drum key`).toBe(true);
      }
    }
  });

  it('returns nothing for an unmapped key', () => {
    expect(drumPieceForKey('q')).toBeUndefined();
  });
});
