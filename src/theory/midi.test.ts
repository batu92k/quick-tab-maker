import { describe, expect, it } from 'vitest';
import * as M from './midi';

const guitar: M.FretboardSpec = { tuning: [...M.TUNINGS.guitar.standard], fretCount: 24, capo: 0 };
const bass: M.FretboardSpec = { tuning: [...M.TUNINGS.bass.standard], fretCount: 24, capo: 0 };

describe('pitch conversion', () => {
  it('matches the MIDI standard reference points', () => {
    expect(M.pitchToMidi('C4')).toBe(60); // middle C
    expect(M.pitchToMidi('A4')).toBe(69); // concert A
    expect(M.pitchToMidi('E2')).toBe(40); // guitar low E
    expect(M.pitchToMidi('E1')).toBe(28); // bass low E
  });

  it('handles enharmonics and both accidental spellings', () => {
    expect(M.pitchToMidi('F#3')).toBe(M.pitchToMidi('Gb3'));
    expect(M.pitchToMidi('Bb3')).toBe(58);
  });

  it('throws on an unparseable pitch rather than sounding the wrong note', () => {
    expect(() => M.pitchToMidi('H4')).toThrow();
    expect(() => M.pitchToMidi('')).toThrow();
  });

  it('round-trips through pitch notation', () => {
    for (const midi of [28, 40, 60, 69, 88]) {
      expect(M.pitchToMidi(M.midiToPitch(midi))).toBe(midi);
    }
  });

  it('converts to frequency', () => {
    expect(M.midiToFrequency(69)).toBeCloseTo(440);
    expect(M.midiToFrequency(81)).toBeCloseTo(880); // one octave up
    expect(M.midiToFrequency(40)).toBeCloseTo(82.41, 2); // low E
  });

  it('reduces to pitch classes', () => {
    expect(M.midiToPitchClass(60)).toBe(0); // C
    expect(M.midiToPitchClass(40)).toBe(4); // E
    expect(M.midiToPitchClass(69)).toBe(9); // A
  });
});

describe('fretboard', () => {
  it('resolves open strings to the tuning pitches', () => {
    expect(M.stringFretToMidi(guitar, 0, 0)).toBe(40); // low E2
    expect(M.stringFretToMidi(guitar, 5, 0)).toBe(64); // high E4
    expect(M.stringFretToMidi(bass, 0, 0)).toBe(28); // bass E1
  });

  it('resolves fretted notes', () => {
    expect(M.stringFretToMidi(guitar, 0, 5)).toBe(45); // 5th fret low E = A2
    expect(M.stringFretToMidi(guitar, 0, 12)).toBe(52); // octave
    // 5th fret of a string equals the next string open...
    expect(M.stringFretToMidi(guitar, 0, 5)).toBe(M.stringFretToMidi(guitar, 1, 0));
    expect(M.stringFretToMidi(guitar, 2, 5)).toBe(M.stringFretToMidi(guitar, 3, 0));
    // ...except across G-B, a major third, where it is the 4th fret.
    expect(M.stringFretToMidi(guitar, 3, 4)).toBe(M.stringFretToMidi(guitar, 4, 0));
  });

  it('applies a capo as a flat offset to open and fretted notes alike', () => {
    const capo3: M.FretboardSpec = { ...guitar, capo: 3 };
    expect(M.stringFretToMidi(capo3, 0, 0)).toBe(43);
    expect(M.stringFretToMidi(capo3, 0, 5)).toBe(48);
  });

  it('rejects out-of-range strings and frets', () => {
    expect(() => M.stringFretToMidi(guitar, 6, 0)).toThrow();
    expect(() => M.stringFretToMidi(guitar, 0, -1)).toThrow();
    expect(() => M.stringFretToMidi(guitar, 0, 25)).toThrow();
  });

  it('finds every position for a pitch, lowest fret first', () => {
    const positions = M.midiToFretPositions(guitar, 45); // A2
    expect(positions[0]).toEqual({ string: 1, fret: 0 }); // open A
    expect(positions).toContainEqual({ string: 0, fret: 5 });
    expect(positions.map((p) => p.fret)).toEqual([...positions.map((p) => p.fret)].sort((a, b) => a - b));
  });

  it('returns no positions for a pitch outside the instrument range', () => {
    expect(M.midiToFretPositions(guitar, 20)).toEqual([]);
    expect(M.midiToFretPositions(guitar, 120)).toEqual([]);
  });

  it('agrees with stringFretToMidi across the whole grid', () => {
    const grid = M.fretboardMidiGrid(guitar);
    expect(grid).toHaveLength(6);
    expect(grid[0]).toHaveLength(25); // frets 0..24 inclusive
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= 24; f++) {
        expect(grid[s]![f]).toBe(M.stringFretToMidi(guitar, s, f));
      }
    }
  });
});

describe('tunings', () => {
  it('lists every preset lowest string first', () => {
    const all = [...Object.values(M.TUNINGS.guitar), ...Object.values(M.TUNINGS.bass)];
    for (const tuning of all) {
      const midis = tuning.map(M.pitchToMidi);
      expect([...midis].sort((a, b) => a - b)).toEqual(midis);
    }
  });

  it('drops only the lowest string for drop tunings', () => {
    expect(M.pitchToMidi(M.TUNINGS.guitar.dropD[0])).toBe(M.pitchToMidi('E2') - 2);
    expect(M.TUNINGS.guitar.dropD.slice(1)).toEqual(M.TUNINGS.guitar.standard.slice(1));
  });
});

describe('drum mapping', () => {
  it('uses the General MIDI percussion numbers', () => {
    expect(M.DRUM_PIECE_TO_GM.kick).toBe(36);
    expect(M.DRUM_PIECE_TO_GM.snare).toBe(38);
    expect(M.DRUM_PIECE_TO_GM.hihat).toBe(42);
    expect(M.DRUM_PIECE_TO_GM.hihatOpen).toBe(46);
    expect(M.DRUM_PIECE_TO_GM.ride).toBe(51);
    expect(M.DRUM_PIECE_TO_GM.crash).toBe(49);
  });

  it('assigns a distinct note to every piece so the reverse map is lossless', () => {
    const notes = Object.values(M.DRUM_PIECE_TO_GM);
    expect(new Set(notes).size).toBe(notes.length);
    for (const [piece, note] of Object.entries(M.DRUM_PIECE_TO_GM)) {
      expect(M.GM_TO_DRUM_PIECE[note]).toBe(piece);
    }
  });
});

describe('velocity', () => {
  it('clamps into the MIDI range and rounds', () => {
    expect(M.clampVelocity(0)).toBe(1);
    expect(M.clampVelocity(200)).toBe(127);
    expect(M.clampVelocity(64.6)).toBe(65);
  });
});
