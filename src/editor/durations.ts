/**
 * Note-duration manipulation for the entry toolbar and keyboard.
 *
 * Durations are stored as raw fractions, which is right for the document but
 * awkward for a UI: "make this shorter" has to know that 3/8 is a dotted
 * quarter so it can produce a dotted eighth rather than some arbitrary smaller
 * fraction. So a fraction is decomposed back into (base, dots, tuplet) here,
 * the change is applied to that structure, and it is recomposed.
 */

import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';

export interface DurationParts {
  /** A power-of-two note value: whole, half, quarter, … */
  readonly base: Fraction;
  readonly dots: 0 | 1 | 2;
  /** Present for tuplets, e.g. 3-in-the-time-of-2 for a triplet. */
  readonly tuplet?: { readonly actual: number; readonly normal: number };
}

const TUPLETS = [
  { actual: 3, normal: 2 }, // triplet
  { actual: 5, normal: 4 }, // quintuplet
  { actual: 7, normal: 4 }, // septuplet
] as const;

/**
 * Recovers the musical spelling of a duration.
 *
 * Falls back to treating an unrecognised fraction as its own base rather than
 * throwing: an imported file may legitimately contain a nested tuplet this app
 * cannot yet spell, and refusing to display it would be worse than showing it
 * as an opaque value.
 */
export function decompose(duration: Fraction): DurationParts {
  for (const base of F.BASE_DURATIONS) {
    if (F.eq(duration, base)) return { base, dots: 0 };
    if (F.eq(duration, F.dotted(base, 1))) return { base, dots: 1 };
    if (F.eq(duration, F.dotted(base, 2))) return { base, dots: 2 };
    for (const tuplet of TUPLETS) {
      if (F.eq(duration, F.tuplet(base, tuplet.actual, tuplet.normal))) {
        return { base, dots: 0, tuplet };
      }
    }
  }
  return { base: duration, dots: 0 };
}

export function compose(parts: DurationParts): Fraction {
  const dotted = F.dotted(parts.base, parts.dots);
  return parts.tuplet ? F.tuplet(dotted, parts.tuplet.actual, parts.tuplet.normal) : dotted;
}

function baseIndex(base: Fraction): number {
  const index = F.BASE_DURATIONS.findIndex((d) => F.eq(d, base));
  return index < 0 ? 2 : index; // default to a quarter note
}

/** Halves the note value: quarter -> eighth. Dots and tuplets are preserved. */
export function shorter(duration: Fraction): Fraction {
  const parts = decompose(duration);
  const next = F.BASE_DURATIONS[Math.min(baseIndex(parts.base) + 1, F.BASE_DURATIONS.length - 1)]!;
  return compose({ ...parts, base: next });
}

/** Doubles the note value: eighth -> quarter. */
export function longer(duration: Fraction): Fraction {
  const parts = decompose(duration);
  const next = F.BASE_DURATIONS[Math.max(baseIndex(parts.base) - 1, 0)]!;
  return compose({ ...parts, base: next });
}

/** Cycles through undotted, dotted, double-dotted. */
export function cycleDots(duration: Fraction): Fraction {
  const parts = decompose(duration);
  const dots = ((parts.dots + 1) % 3) as 0 | 1 | 2;
  return compose({ ...parts, dots });
}

/** Toggles a triplet on or off, leaving other tuplets alone. */
export function toggleTriplet(duration: Fraction): Fraction {
  const parts = decompose(duration);
  if (parts.tuplet) {
    const { tuplet: _drop, ...rest } = parts;
    return compose(rest);
  }
  return compose({ ...parts, tuplet: { actual: 3, normal: 2 } });
}

const BASE_NAMES = ['Whole', 'Half', 'Quarter', '8th', '16th', '32nd', '64th'];

/** A short human-readable name, e.g. "Dotted 8th" or "16th triplet". */
export function durationLabel(duration: Fraction): string {
  const parts = decompose(duration);
  const index = F.BASE_DURATIONS.findIndex((d) => F.eq(d, parts.base));
  if (index < 0) return F.toString(duration);

  const dots = parts.dots === 1 ? 'Dotted ' : parts.dots === 2 ? 'Double-dotted ' : '';
  const tuplet =
    parts.tuplet?.actual === 3
      ? ' triplet'
      : parts.tuplet
        ? ` ${parts.tuplet.actual}-tuplet`
        : '';
  return `${dots}${BASE_NAMES[index]}${tuplet}`;
}

/** Durations offered as toolbar buttons. */
export const TOOLBAR_DURATIONS: readonly Fraction[] = [
  F.WHOLE,
  F.HALF,
  F.QUARTER,
  F.EIGHTH,
  F.SIXTEENTH,
  F.THIRTY_SECOND,
];

/** Compact glyph-ish label for a toolbar button. */
export function durationShortLabel(duration: Fraction): string {
  const index = F.BASE_DURATIONS.findIndex((d) => F.eq(d, decompose(duration).base));
  return ['1', '2', '4', '8', '16', '32', '64'][index] ?? '?';
}
