/**
 * Chord naming.
 *
 * The cases that matter are the two things tonal does not do on its own: naming
 * a plain major triad `C` rather than `CM`, and preferring a slash inversion
 * over the augmented re-spelling tonal offers first. A mirror that gets the
 * bass note wrong labels the sheet with a chord the player is not fingering.
 */

import { describe, expect, it } from 'vitest';
import { chordForStringBeat, chordNameForMidi } from './chords';
import { pitchToMidi, type FretboardSpec } from './midi';
import type { Note } from '../model/types';

const midis = (...pitches: string[]): number[] => pitches.map(pitchToMidi);

describe('chordNameForMidi', () => {
  it('names a major triad without the redundant M', () => {
    expect(chordNameForMidi(midis('C4', 'E4', 'G4'))).toBe('C');
    expect(chordNameForMidi(midis('G3', 'B3', 'D4'))).toBe('G');
  });

  it('keeps the quality for anything past a plain major triad', () => {
    expect(chordNameForMidi(midis('C4', 'Eb4', 'G4'))).toBe('Cm');
    expect(chordNameForMidi(midis('C4', 'E4', 'G4', 'B4'))).toBe('Cmaj7');
    expect(chordNameForMidi(midis('C4', 'E4', 'G4', 'Bb4'))).toBe('C7');
    expect(chordNameForMidi(midis('A3', 'C4', 'E4', 'G4'))).toBe('Am7');
  });

  it('names an inversion as a slash chord, not an altered root', () => {
    // tonal offers Em#5 before CM/E; the bass note is what the player needs.
    expect(chordNameForMidi(midis('E3', 'G3', 'C4'))).toBe('C/E');
    expect(chordNameForMidi(midis('B3', 'D4', 'G4'))).toBe('G/B');
    expect(chordNameForMidi(midis('G3', 'C4', 'E4'))).toBe('C/G');
  });

  it('names a power chord but not a bare third', () => {
    expect(chordNameForMidi(midis('E3', 'B3'))).toBe('E5');
    expect(chordNameForMidi(midis('E3', 'G3'))).toBeNull();
  });

  it('is null for a single note', () => {
    expect(chordNameForMidi(midis('C4'))).toBeNull();
    expect(chordNameForMidi([])).toBeNull();
  });

  it('collapses octave doublings and keeps the lowest as the bass', () => {
    // A common open C shape: C E G C E across the strings.
    expect(chordNameForMidi(midis('C3', 'E3', 'G3', 'C4', 'E4'))).toBe('C');
  });
});

describe('chordForStringBeat', () => {
  const spec: FretboardSpec = {
    tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    fretCount: 24,
    capo: 0,
  };
  const note = (string: number, fret: number): Note => ({
    id: `n${string}_${fret}`,
    string,
    fret,
    techniques: [],
  });

  it('names an open C chord fingered on the neck', () => {
    // x 3 2 0 1 0 -> A(3)=C, D(2)=E, G(0)=G, B(1)=C, e(0)=E
    const notes = [note(1, 3), note(2, 2), note(3, 0), note(4, 1), note(5, 0)];
    expect(chordForStringBeat(spec, notes)).toBe('C');
  });

  it('respects the capo through the shared resolver', () => {
    const capoed: FretboardSpec = { ...spec, capo: 2 };
    // The open C shape two frets up sounds a D chord.
    const notes = [note(1, 3), note(2, 2), note(3, 0), note(4, 1), note(5, 0)];
    expect(chordForStringBeat(capoed, notes)).toBe('D');
  });

  it('is null for a single fretted note', () => {
    expect(chordForStringBeat(spec, [note(0, 3)])).toBeNull();
  });
});
