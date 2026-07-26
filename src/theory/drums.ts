/**
 * How drum pieces are arranged on a standard five-line percussion staff.
 *
 * There are more pieces than staff positions: closed, open and pedal hi-hat, or
 * a ride and its bell, share a position and are told apart by their notehead —
 * exactly as in written drum notation. So the mapping is voice -> set of pieces,
 * with one designated as the voice's default for click-to-place entry.
 *
 * The editor keeps addressing drums by these nine voices (the cursor moves
 * between them and note entry targets one), while the renderer places each on
 * its conventional staff position with a stem — hands up, feet down. Keeping the
 * voice model here, in `theory/`, lets the store move the cursor without
 * depending on the renderer.
 *
 * Voices are ordered strictly top to bottom on the staff, so the cursor's
 * up/down arrows track the visual order: cymbals above, toms descending, snare,
 * floor tom, then the feet.
 */

import type { DrumPiece } from '../model/types';

export interface DrumRow {
  /** 0 is the top voice. */
  readonly row: number;
  /** Short label, still used by the drum-kit input panel. */
  readonly label: string;
  readonly name: string;
  /** Placed when the user targets this voice without choosing a variant. */
  readonly defaultPiece: DrumPiece;
  /** Every piece drawn on this position. */
  readonly pieces: readonly DrumPiece[];
  /**
   * Vertical position on the five-line staff, in line-spacings from the top
   * line (0 = top line, +1 per line down, spaces at the half). Negative sits
   * above the staff, values past 4 below it. Snare lands on the third space and
   * the kick on the bottom space, as convention has it.
   */
  readonly position: number;
}

export const DRUM_ROWS: readonly DrumRow[] = [
  { row: 0, label: 'CC', name: 'Crash', defaultPiece: 'crash', position: -1, pieces: ['crash', 'crash2', 'splash', 'china'] },
  { row: 1, label: 'HH', name: 'Hi-hat', defaultPiece: 'hihat', position: -0.5, pieces: ['hihat', 'hihatOpen'] },
  { row: 2, label: 'RD', name: 'Ride', defaultPiece: 'ride', position: 0, pieces: ['ride', 'rideBell', 'cowbell'] },
  { row: 3, label: 'T1', name: 'High tom', defaultPiece: 'tom1', position: 0.5, pieces: ['tom1'] },
  { row: 4, label: 'T2', name: 'Mid tom', defaultPiece: 'tom2', position: 1, pieces: ['tom2'] },
  { row: 5, label: 'SN', name: 'Snare', defaultPiece: 'snare', position: 1.5, pieces: ['snare', 'sideStick'] },
  { row: 6, label: 'FT', name: 'Floor tom', defaultPiece: 'floorTom', position: 2.5, pieces: ['floorTom'] },
  { row: 7, label: 'BD', name: 'Kick', defaultPiece: 'kick', position: 3.5, pieces: ['kick'] },
  { row: 8, label: 'HF', name: 'Hi-hat pedal', defaultPiece: 'hihatPedal', position: 4.5, pieces: ['hihatPedal'] },
];

export const DRUM_ROW_COUNT = DRUM_ROWS.length;
/** Lines drawn for the percussion staff. */
export const DRUM_STAFF_LINES = 5;

const PIECE_TO_ROW: Readonly<Record<DrumPiece, number>> = Object.fromEntries(
  DRUM_ROWS.flatMap((r) => r.pieces.map((piece) => [piece, r.row])),
) as Record<DrumPiece, number>;

/** The staff voice a piece is drawn on. */
export function rowForPiece(piece: DrumPiece): number {
  return PIECE_TO_ROW[piece];
}

export function drumRow(row: number): DrumRow | undefined {
  return DRUM_ROWS[row];
}

/** The piece placed when a voice is targeted without choosing a variant. */
export function defaultPieceForRow(row: number): DrumPiece | undefined {
  return DRUM_ROWS[row]?.defaultPiece;
}

/** Staff position of a voice, in line-spacings from the top line. */
export function positionForRow(row: number): number {
  return DRUM_ROWS[row]?.position ?? 2;
}

/** Staff position of a piece, in line-spacings from the top line. */
export function positionForPiece(piece: DrumPiece): number {
  return positionForRow(rowForPiece(piece));
}

/**
 * Stem direction. Standard drumset notation stems the feet down (kick and
 * hi-hat pedal) and everything the hands play up, which is how a reader tells a
 * foot pattern from a hand pattern at a glance.
 */
export function stemDirection(piece: DrumPiece): 'up' | 'down' {
  return piece === 'kick' || piece === 'hihatPedal' ? 'down' : 'up';
}

/**
 * Notehead shape per piece. Cymbals are crosses and drums are dots, which is
 * how a drummer reads the line at a glance.
 */
export type NoteheadShape = 'dot' | 'cross' | 'circledCross' | 'diamond';

export function noteheadFor(piece: DrumPiece): NoteheadShape {
  switch (piece) {
    case 'hihatOpen':
      return 'circledCross';
    case 'rideBell':
    case 'cowbell':
      return 'diamond';
    case 'hihat':
    case 'hihatPedal':
    case 'crash':
    case 'crash2':
    case 'ride':
    case 'china':
    case 'splash':
      return 'cross';
    default:
      return 'dot';
  }
}
