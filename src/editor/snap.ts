import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';

/** Snap grid choices, coarsest first. `null` is free positioning. */
export const SNAP_OPTIONS: readonly { readonly label: string; readonly value: Fraction | null }[] = [
  { label: 'Off', value: null },
  { label: '1/4', value: F.QUARTER },
  { label: '1/8', value: F.EIGHTH },
  { label: '1/16', value: F.SIXTEENTH },
  { label: '1/32', value: F.THIRTY_SECOND },
];

export function snapIndex(snap: Fraction | null): number {
  return SNAP_OPTIONS.findIndex((o) =>
    o.value === null ? snap === null : snap !== null && F.eq(o.value, snap),
  );
}
