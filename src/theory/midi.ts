/**
 * The single place where anything in the app turns into a MIDI note number.
 *
 * The audio engine, the theory overlays, and (later) Web MIDI input/output and
 * MIDI file export all go through these functions. Keeping one resolver is what
 * lets MIDI arrive later as an addition instead of a refactor: a Web MIDI source
 * only has to produce the same numbers these functions already produce.
 */

import { Note } from 'tonal';
import type { DrumPiece, StringTrack } from '../model/types';

/** Middle C (C4) is MIDI 60. A4 = 69 = 440Hz. */
export const MIDDLE_C = 60;
export const A4_MIDI = 69;
export const A4_HZ = 440;

/**
 * Converts scientific pitch notation to a MIDI note number.
 * Throws rather than returning null: an unparseable tuning is a bug in the
 * document, and silently sounding the wrong pitch is worse than failing loudly.
 */
export function pitchToMidi(pitch: string): number {
  const midi = Note.midi(pitch);
  if (midi === null) throw new Error(`Unrecognised pitch: ${JSON.stringify(pitch)}`);
  return midi;
}

/** Converts a MIDI note number to scientific pitch notation, e.g. 40 -> 'E2'. */
export function midiToPitch(midi: number): string {
  return Note.fromMidi(midi);
}

/** Converts a MIDI note number to frequency in Hz (12-TET, A4 = 440Hz). */
export function midiToFrequency(midi: number): number {
  return A4_HZ * 2 ** ((midi - A4_MIDI) / 12);
}

/** Pitch class 0-11, where 0 = C. Useful for scale/chord membership tests. */
export function midiToPitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/* -------------------------------------------------------------------------- */
/* Fretboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface FretboardSpec {
  /** Scientific pitch per string, LOWEST first. */
  readonly tuning: readonly string[];
  readonly fretCount: number;
  readonly capo: number;
}

/** Narrows a track to just the fretboard geometry the theory helpers need. */
export function specOf(track: StringTrack): FretboardSpec {
  return { tuning: track.tuning, fretCount: track.fretCount, capo: track.capo };
}

/**
 * Resolves a string/fret position to a MIDI note number.
 *
 * A capo raises every string, including open ones, so it is a flat semitone
 * offset. Fret numbers in the document stay absolute (measured from the nut),
 * which means moving the capo does not rewrite the tab.
 */
export function stringFretToMidi(spec: FretboardSpec, stringIndex: number, fret: number): number {
  const open = spec.tuning[stringIndex];
  if (open === undefined) {
    throw new Error(`String index ${stringIndex} out of range for ${spec.tuning.length}-string tuning`);
  }
  if (fret < 0 || fret > spec.fretCount) {
    throw new Error(`Fret ${fret} out of range 0-${spec.fretCount}`);
  }
  return pitchToMidi(open) + fret + spec.capo;
}

export interface FretPosition {
  readonly string: number;
  readonly fret: number;
}

/**
 * Every playable position for a pitch, nearest-to-the-nut first.
 *
 * Used to place a note when input arrives without a string (MIDI keyboard, or
 * clicking a pitch in the theory panel) and to highlight scale notes on the
 * fretboard.
 */
export function midiToFretPositions(spec: FretboardSpec, midi: number): FretPosition[] {
  const positions: FretPosition[] = [];
  for (let s = 0; s < spec.tuning.length; s++) {
    const open = pitchToMidi(spec.tuning[s]!);
    const fret = midi - open - spec.capo;
    if (fret >= 0 && fret <= spec.fretCount) positions.push({ string: s, fret });
  }
  return positions.sort((a, b) => a.fret - b.fret || a.string - b.string);
}

/** The full grid of MIDI numbers, indexed `[string][fret]`. Cached by callers. */
export function fretboardMidiGrid(spec: FretboardSpec): number[][] {
  return spec.tuning.map((open) => {
    const base = pitchToMidi(open) + spec.capo;
    return Array.from({ length: spec.fretCount + 1 }, (_, fret) => base + fret);
  });
}

/* -------------------------------------------------------------------------- */
/* Tunings                                                                    */
/* -------------------------------------------------------------------------- */

/** Presets offered in the UI. Every entry is lowest string first. */
export const TUNINGS = {
  guitar: {
    standard: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    dropD: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
    halfStepDown: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'],
    fullStepDown: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'],
    dropC: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'],
    openG: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
    openD: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'],
    dadgad: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
    sevenString: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
  },
  bass: {
    standard: ['E1', 'A1', 'D2', 'G2'],
    dropD: ['D1', 'A1', 'D2', 'G2'],
    fiveString: ['B0', 'E1', 'A1', 'D2', 'G2'],
    sixString: ['B0', 'E1', 'A1', 'D2', 'G2', 'C3'],
  },
} as const;

export const DEFAULT_GUITAR_TUNING: readonly string[] = TUNINGS.guitar.standard;
export const DEFAULT_BASS_TUNING: readonly string[] = TUNINGS.bass.standard;

/* -------------------------------------------------------------------------- */
/* Drums                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * General MIDI percussion map (channel 10). Drum "pitches" are really
 * instrument selectors, so this is a lookup rather than a calculation — but it
 * lives beside the pitch resolver so every sound in the app is addressed the
 * same way.
 */
export const DRUM_PIECE_TO_GM: Readonly<Record<DrumPiece, number>> = {
  kick: 36, // Bass Drum 1
  sideStick: 37,
  snare: 38, // Acoustic Snare
  hihatPedal: 44, // Pedal Hi-Hat
  hihat: 42, // Closed Hi-Hat
  hihatOpen: 46, // Open Hi-Hat
  tom2: 45, // Low Tom
  floorTom: 43, // High Floor Tom
  tom1: 48, // Hi-Mid Tom
  crash: 49, // Crash Cymbal 1
  ride: 51, // Ride Cymbal 1
  china: 52, // Chinese Cymbal
  rideBell: 53,
  splash: 55,
  cowbell: 56,
  crash2: 57, // Crash Cymbal 2
};

/** Reverse map, for interpreting incoming MIDI from an electronic kit. */
export const GM_TO_DRUM_PIECE: Readonly<Record<number, DrumPiece>> = Object.fromEntries(
  Object.entries(DRUM_PIECE_TO_GM).map(([piece, note]) => [note, piece as DrumPiece]),
);

/* -------------------------------------------------------------------------- */
/* Velocity                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_VELOCITY = 96;
export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

export function clampVelocity(v: number): number {
  return Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, Math.round(v)));
}
