/**
 * Exact rational arithmetic for musical time.
 *
 * Every position and duration in a song is measured in *whole notes* and stored
 * as a fraction. Floats are not an option here: a triplet eighth is 1/12, which
 * has no exact binary representation, so accumulating them across a few hundred
 * measures drifts enough to misorder notes and land the playhead between beats.
 */

export interface Fraction {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * Builds a fraction in canonical form: reduced, with the sign carried by the
 * numerator and a strictly positive denominator. All other operations assume
 * their inputs are canonical, which is why this is the only constructor.
 */
export function frac(n: number, d = 1): Fraction {
  if (d === 0) throw new Error('Fraction: denominator must be non-zero');
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`Fraction: expected integers, got ${n}/${d}`);
  }
  if (n === 0) return { n: 0, d: 1 };
  const sign = d < 0 ? -1 : 1;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const ZERO: Fraction = { n: 0, d: 1 };
export const ONE: Fraction = { n: 1, d: 1 };

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function div(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0) throw new Error('Fraction: division by zero');
  return frac(a.n * b.d, a.d * b.n);
}

/** Scales by an integer — the common case for "n copies of this duration". */
export function scale(a: Fraction, k: number): Fraction {
  return frac(a.n * k, a.d);
}

/** Returns a negative number, zero, or a positive number, like a sort comparator. */
export function cmp(a: Fraction, b: Fraction): number {
  return a.n * b.d - b.n * a.d;
}

export function eq(a: Fraction, b: Fraction): boolean {
  return a.n === b.n && a.d === b.d;
}

export const lt = (a: Fraction, b: Fraction): boolean => cmp(a, b) < 0;
export const lte = (a: Fraction, b: Fraction): boolean => cmp(a, b) <= 0;
export const gt = (a: Fraction, b: Fraction): boolean => cmp(a, b) > 0;
export const gte = (a: Fraction, b: Fraction): boolean => cmp(a, b) >= 0;

export const isZero = (a: Fraction): boolean => a.n === 0;
export const isPositive = (a: Fraction): boolean => a.n > 0;

export function min(a: Fraction, b: Fraction): Fraction {
  return lte(a, b) ? a : b;
}

export function max(a: Fraction, b: Fraction): Fraction {
  return gte(a, b) ? a : b;
}

export function neg(a: Fraction): Fraction {
  // Guard the zero case explicitly: `-0` is still canonical-looking but breaks
  // structural equality against ZERO, and it propagates through arithmetic.
  return a.n === 0 ? ZERO : { n: -a.n, d: a.d };
}

/** Lossy — for layout maths and converting to seconds only, never for storage. */
export function toNumber(a: Fraction): number {
  return a.n / a.d;
}

export function toString(a: Fraction): string {
  return a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
}

/** Parses "3/4", "3:4" or "2". Throws on anything else. */
export function parseFraction(s: string): Fraction {
  const m = /^\s*(-?\d+)\s*(?:[/:]\s*(\d+)\s*)?$/.exec(s);
  if (!m) throw new Error(`Fraction: cannot parse ${JSON.stringify(s)}`);
  return frac(Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
}

/* -------------------------------------------------------------------------- */
/* Musical durations                                                          */
/* -------------------------------------------------------------------------- */

export const WHOLE = frac(1);
export const HALF = frac(1, 2);
export const QUARTER = frac(1, 4);
export const EIGHTH = frac(1, 8);
export const SIXTEENTH = frac(1, 16);
export const THIRTY_SECOND = frac(1, 32);
export const SIXTY_FOURTH = frac(1, 64);

/** Base note values, longest first — the durations a user can pick directly. */
export const BASE_DURATIONS = [
  WHOLE,
  HALF,
  QUARTER,
  EIGHTH,
  SIXTEENTH,
  THIRTY_SECOND,
  SIXTY_FOURTH,
] as const;

/**
 * Applies augmentation dots. Each dot adds half of what came before, so
 * `dotted(QUARTER, 1)` is 3/8 and `dotted(QUARTER, 2)` is 7/16.
 */
export function dotted(base: Fraction, dots = 1): Fraction {
  if (dots < 0 || !Number.isInteger(dots)) throw new Error('dotted: dots must be a non-negative integer');
  // Closed form: base * (2^(dots+1) - 1) / 2^dots
  const pow = 2 ** dots;
  return mul(base, frac(2 * pow - 1, pow));
}

/**
 * Applies a tuplet ratio: `actual` notes played in the time of `normal`.
 * An eighth-note triplet is `tuplet(EIGHTH, 3, 2)` = 1/12.
 */
export function tuplet(base: Fraction, actual: number, normal: number): Fraction {
  return mul(base, frac(normal, actual));
}

/** Duration of one bar in whole notes, e.g. 3/4 -> 3/4, 6/8 -> 6/8. */
export function measureDuration(numerator: number, denominator: number): Fraction {
  return frac(numerator, denominator);
}

/** Converts a duration in whole notes to seconds at a given tempo. */
export function toSeconds(duration: Fraction, bpm: number, beatUnit: Fraction = QUARTER): number {
  const beats = toNumber(div(duration, beatUnit));
  return (beats * 60) / bpm;
}
