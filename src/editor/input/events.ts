/**
 * The one shape every note-entry device produces.
 *
 * A click on the fretboard, a tap on a drum pad, a computer key and — later — a
 * MIDI message all become a `NoteInputEvent`, which `applyNoteInput` turns into
 * a document edit. Devices decide only *what was played*; the editor decides
 * what that means at the current cursor.
 *
 * The `pitch` variant exists specifically for MIDI: a keyboard sends a note
 * number with no idea which string to use, so the resolution from pitch to a
 * fret position is part of the editor rather than part of any device.
 */

import type { DrumPiece } from '../../model/types';
import { DEFAULT_VELOCITY } from '../../theory/midi';

export type NoteInputSource = 'mouse' | 'keyboard' | 'midi';

interface InputBase {
  readonly source: NoteInputSource;
  /** MIDI velocity, 1-127. Devices without pressure send the default. */
  readonly velocity: number;
  /** `performance.now()` when the gesture happened. */
  readonly timestamp: number;
}

/** A specific position on the neck — from the fretboard, or typed digits. */
export interface FretInput extends InputBase {
  readonly kind: 'fret';
  /** Document string index: 0 is the lowest-pitched string. */
  readonly string: number;
  readonly fret: number;
}

/** A pitch with no position chosen. The editor picks a playable fret. */
export interface PitchInput extends InputBase {
  readonly kind: 'pitch';
  readonly midi: number;
}

export interface DrumInput extends InputBase {
  readonly kind: 'drum';
  readonly piece: DrumPiece;
}

export type NoteInputEvent = FretInput | PitchInput | DrumInput;

/* -------------------------------------------------------------------------- */
/* Constructors                                                               */
/* -------------------------------------------------------------------------- */

const now = (): number =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

export function fretInput(
  string: number,
  fret: number,
  options: { source?: NoteInputSource; velocity?: number } = {},
): FretInput {
  return {
    kind: 'fret',
    string,
    fret,
    source: options.source ?? 'mouse',
    velocity: options.velocity ?? DEFAULT_VELOCITY,
    timestamp: now(),
  };
}

export function pitchInput(
  midi: number,
  options: { source?: NoteInputSource; velocity?: number } = {},
): PitchInput {
  return {
    kind: 'pitch',
    midi,
    source: options.source ?? 'midi',
    velocity: options.velocity ?? DEFAULT_VELOCITY,
    timestamp: now(),
  };
}

export function drumInput(
  piece: DrumPiece,
  options: { source?: NoteInputSource; velocity?: number } = {},
): DrumInput {
  return {
    kind: 'drum',
    piece,
    source: options.source ?? 'mouse',
    velocity: options.velocity ?? DEFAULT_VELOCITY,
    timestamp: now(),
  };
}
