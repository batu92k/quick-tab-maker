/**
 * How drum pieces are arranged on a staff.
 *
 * A drum tab is a grid of rows, but there are more pieces than rows: closed,
 * open and pedal hi-hat all share the hi-hat line and are told apart by their
 * notehead, exactly as in written drum notation. So the mapping is row -> set of
 * pieces, with one designated as the row's default for click-to-place entry.
 *
 * This lives in `theory/` rather than `render/` because the editor cursor moves
 * between these rows, so the store needs the row count without depending on the
 * renderer.
 */

import type { DrumPiece } from '../model/types';

export interface DrumRow {
  /** 0 is the top row. */
  readonly row: number;
  /** Short label shown at the left of the staff. */
  readonly label: string;
  readonly name: string;
  /** Placed when the user clicks this row without choosing a variant. */
  readonly defaultPiece: DrumPiece;
  /** Every piece drawn on this line. */
  readonly pieces: readonly DrumPiece[];
}

/**
 * Ordered top to bottom, following conventional drum notation: cymbals above,
 * toms descending by pitch, then snare and kick.
 */
export const DRUM_ROWS: readonly DrumRow[] = [
  {
    row: 0,
    label: 'CC',
    name: 'Crash',
    defaultPiece: 'crash',
    pieces: ['crash', 'crash2', 'splash', 'china'],
  },
  {
    row: 1,
    label: 'HH',
    name: 'Hi-hat',
    defaultPiece: 'hihat',
    pieces: ['hihat', 'hihatOpen'],
  },
  {
    row: 2,
    label: 'RD',
    name: 'Ride',
    defaultPiece: 'ride',
    pieces: ['ride', 'rideBell', 'cowbell'],
  },
  { row: 3, label: 'T1', name: 'High tom', defaultPiece: 'tom1', pieces: ['tom1'] },
  { row: 4, label: 'T2', name: 'Mid tom', defaultPiece: 'tom2', pieces: ['tom2'] },
  { row: 5, label: 'FT', name: 'Floor tom', defaultPiece: 'floorTom', pieces: ['floorTom'] },
  {
    row: 6,
    label: 'SN',
    name: 'Snare',
    defaultPiece: 'snare',
    pieces: ['snare', 'sideStick'],
  },
  { row: 7, label: 'BD', name: 'Kick', defaultPiece: 'kick', pieces: ['kick'] },
  { row: 8, label: 'HF', name: 'Hi-hat pedal', defaultPiece: 'hihatPedal', pieces: ['hihatPedal'] },
];

export const DRUM_ROW_COUNT = DRUM_ROWS.length;

const PIECE_TO_ROW: Readonly<Record<DrumPiece, number>> = Object.fromEntries(
  DRUM_ROWS.flatMap((r) => r.pieces.map((piece) => [piece, r.row])),
) as Record<DrumPiece, number>;

/** The staff row a piece is drawn on. */
export function rowForPiece(piece: DrumPiece): number {
  return PIECE_TO_ROW[piece];
}

export function drumRow(row: number): DrumRow | undefined {
  return DRUM_ROWS[row];
}

/** The piece placed when a row is clicked without choosing a variant. */
export function defaultPieceForRow(row: number): DrumPiece | undefined {
  return DRUM_ROWS[row]?.defaultPiece;
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
