/**
 * Keyboard mapping for finger drumming.
 *
 * These letters overlap the technique shortcuts (H hammer-on, B bend, …) on
 * purpose. Technique bindings are marked `stringOnly` and drum keys apply only
 * on a drum track, so the two sets can never both be live — which frees the
 * whole home-row area for drumming instead of pushing it onto awkward keys.
 *
 * The layout mirrors a kit seen from the player's seat: kick and snare under
 * the strong fingers, toms running left to right in pitch order, cymbals above.
 */

import type { DrumPiece } from '../../model/types';

export interface DrumKeyBinding {
  readonly key: string;
  readonly piece: DrumPiece;
  readonly label: string;
}

export const DRUM_KEYS: readonly DrumKeyBinding[] = [
  { key: 'v', piece: 'kick', label: 'Kick' },
  { key: 'b', piece: 'snare', label: 'Snare' },
  { key: 'n', piece: 'hihat', label: 'Hi-hat' },
  { key: 'm', piece: 'hihatOpen', label: 'Open hi-hat' },
  { key: ',', piece: 'hihatPedal', label: 'Hi-hat pedal' },
  { key: 'g', piece: 'tom1', label: 'High tom' },
  { key: 'h', piece: 'tom2', label: 'Mid tom' },
  { key: 'j', piece: 'floorTom', label: 'Floor tom' },
  { key: 'k', piece: 'ride', label: 'Ride' },
  { key: 'l', piece: 'crash', label: 'Crash' },
];

const BY_KEY: ReadonlyMap<string, DrumKeyBinding> = new Map(
  DRUM_KEYS.map((binding) => [binding.key, binding]),
);

export function drumPieceForKey(key: string): DrumPiece | undefined {
  return BY_KEY.get(key.toLowerCase())?.piece;
}

const BY_PIECE: Partial<Record<DrumPiece, string>> = Object.fromEntries(
  DRUM_KEYS.map((binding) => [binding.piece, binding.key]),
);

/** The key that plays a piece, for labelling pads in the kit illustration. */
export function keyForDrumPiece(piece: DrumPiece): string | undefined {
  return BY_PIECE[piece];
}
