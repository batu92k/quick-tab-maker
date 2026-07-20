import { describe, expect, it } from 'vitest';
import * as F from './fraction';

const { frac } = F;

describe('frac', () => {
  it('reduces to lowest terms', () => {
    expect(frac(6, 8)).toEqual({ n: 3, d: 4 });
    expect(frac(100, 10)).toEqual({ n: 10, d: 1 });
  });

  it('normalises sign onto the numerator', () => {
    expect(frac(1, -2)).toEqual({ n: -1, d: 2 });
    expect(frac(-1, -2)).toEqual({ n: 1, d: 2 });
  });

  it('collapses every representation of zero', () => {
    expect(frac(0, 5)).toEqual({ n: 0, d: 1 });
    expect(frac(-0, 5)).toEqual({ n: 0, d: 1 });
  });

  it('rejects a zero denominator and non-integers', () => {
    expect(() => frac(1, 0)).toThrow();
    expect(() => frac(1.5, 2)).toThrow();
  });
});

describe('arithmetic', () => {
  it('adds and subtracts across unlike denominators', () => {
    expect(F.add(frac(1, 3), frac(1, 6))).toEqual(frac(1, 2));
    expect(F.sub(frac(1, 2), frac(1, 3))).toEqual(frac(1, 6));
  });

  it('multiplies, divides and scales', () => {
    expect(F.mul(frac(2, 3), frac(3, 4))).toEqual(frac(1, 2));
    expect(F.div(frac(1, 2), frac(1, 4))).toEqual(frac(2, 1));
    expect(F.scale(frac(1, 8), 3)).toEqual(frac(3, 8));
    expect(() => F.div(F.ONE, F.ZERO)).toThrow();
  });

  it('negates without denormalising', () => {
    expect(F.neg(frac(1, 4))).toEqual(frac(-1, 4));
    expect(F.neg(F.ZERO)).toEqual(F.ZERO);
  });
});

describe('comparison', () => {
  it('orders correctly, including negatives', () => {
    expect(F.lt(frac(1, 3), frac(1, 2))).toBe(true);
    expect(F.gt(frac(-1, 3), frac(-1, 2))).toBe(true);
    expect(F.cmp(frac(2, 4), frac(1, 2))).toBe(0);
  });

  it('treats equal values as equal regardless of how they were built', () => {
    expect(F.eq(frac(2, 4), frac(1, 2))).toBe(true);
    expect(F.eq(frac(1, 2), frac(1, 3))).toBe(false);
  });

  it('sorts a list of note positions', () => {
    const positions = [frac(1, 2), frac(1, 12), frac(1, 4), F.ZERO, frac(1, 3)];
    const sorted = [...positions].sort(F.cmp).map(F.toString);
    expect(sorted).toEqual(['0', '1/12', '1/4', '1/3', '1/2']);
  });

  it('picks min and max', () => {
    expect(F.min(frac(1, 3), frac(1, 4))).toEqual(frac(1, 4));
    expect(F.max(frac(1, 3), frac(1, 4))).toEqual(frac(1, 3));
  });
});

describe('musical durations', () => {
  it('applies augmentation dots', () => {
    expect(F.dotted(F.QUARTER)).toEqual(frac(3, 8));
    expect(F.dotted(F.HALF)).toEqual(frac(3, 4));
    expect(F.dotted(F.QUARTER, 2)).toEqual(frac(7, 16));
    expect(F.dotted(F.QUARTER, 0)).toEqual(F.QUARTER);
    expect(() => F.dotted(F.QUARTER, -1)).toThrow();
  });

  it('applies tuplet ratios exactly', () => {
    expect(F.tuplet(F.EIGHTH, 3, 2)).toEqual(frac(1, 12));
    expect(F.tuplet(F.QUARTER, 3, 2)).toEqual(frac(1, 6));
    expect(F.tuplet(F.SIXTEENTH, 5, 4)).toEqual(frac(1, 20));
  });

  it('fills a 4/4 bar exactly with twelve triplet eighths', () => {
    // The float version of this accumulates error; the exact version must not.
    const tripletEighth = F.tuplet(F.EIGHTH, 3, 2);
    let total = F.ZERO;
    for (let i = 0; i < 12; i++) total = F.add(total, tripletEighth);
    expect(total).toEqual(F.WHOLE);
    expect(F.eq(total, F.measureDuration(4, 4))).toBe(true);
  });

  it('stays exact over a long song', () => {
    // 200 bars of triplet eighths: floats drift here, fractions must not.
    const tripletEighth = F.tuplet(F.EIGHTH, 3, 2);
    let total = F.ZERO;
    for (let i = 0; i < 200 * 12; i++) total = F.add(total, tripletEighth);
    expect(total).toEqual(frac(200));
  });

  it('computes measure durations', () => {
    expect(F.measureDuration(4, 4)).toEqual(F.WHOLE);
    expect(F.measureDuration(3, 4)).toEqual(frac(3, 4));
    expect(F.measureDuration(6, 8)).toEqual(frac(3, 4));
    expect(F.measureDuration(7, 8)).toEqual(frac(7, 8));
  });
});

describe('conversion', () => {
  it('converts durations to seconds at a tempo', () => {
    // One quarter note at 120bpm is half a second.
    expect(F.toSeconds(F.QUARTER, 120)).toBeCloseTo(0.5);
    // A 4/4 bar at 120bpm is two seconds.
    expect(F.toSeconds(F.WHOLE, 120)).toBeCloseTo(2);
    expect(F.toSeconds(F.QUARTER, 60)).toBeCloseTo(1);
  });

  it('round-trips through the string form', () => {
    for (const s of ['3/4', '1/12', '-1/2', '2']) {
      expect(F.toString(F.parseFraction(s))).toBe(s);
    }
    expect(F.parseFraction('3:4')).toEqual(frac(3, 4));
    expect(() => F.parseFraction('abc')).toThrow();
  });

  it('converts to a number for layout maths', () => {
    expect(F.toNumber(frac(3, 4))).toBeCloseTo(0.75);
  });
});
