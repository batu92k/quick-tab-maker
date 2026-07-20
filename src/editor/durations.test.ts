import { describe, expect, it } from 'vitest';
import * as F from '../model/fraction';
import * as D from './durations';

describe('decompose', () => {
  it('recognises plain note values', () => {
    expect(D.decompose(F.QUARTER)).toEqual({ base: F.QUARTER, dots: 0 });
    expect(D.decompose(F.WHOLE)).toEqual({ base: F.WHOLE, dots: 0 });
  });

  it('recognises dotted values', () => {
    // 3/8 is a dotted quarter, not "some fraction between an eighth and a half".
    expect(D.decompose(F.frac(3, 8))).toEqual({ base: F.QUARTER, dots: 1 });
    expect(D.decompose(F.frac(7, 16))).toEqual({ base: F.QUARTER, dots: 2 });
  });

  it('recognises triplets', () => {
    expect(D.decompose(F.frac(1, 12))).toEqual({
      base: F.EIGHTH,
      dots: 0,
      tuplet: { actual: 3, normal: 2 },
    });
  });

  it('round-trips through compose', () => {
    const values = [
      F.WHOLE,
      F.QUARTER,
      F.frac(3, 8),
      F.frac(7, 16),
      F.frac(1, 12),
      F.tuplet(F.SIXTEENTH, 3, 2),
    ];
    for (const value of values) {
      expect(D.compose(D.decompose(value))).toEqual(value);
    }
  });

  it('falls back rather than throwing on an unrecognisable value', () => {
    // An imported file may contain a nested tuplet this app cannot spell yet;
    // displaying it opaquely beats refusing to open the song.
    const odd = F.frac(5, 23);
    expect(() => D.decompose(odd)).not.toThrow();
    expect(D.compose(D.decompose(odd))).toEqual(odd);
  });
});

describe('stepping note values', () => {
  it('halves and doubles', () => {
    expect(D.shorter(F.QUARTER)).toEqual(F.EIGHTH);
    expect(D.longer(F.EIGHTH)).toEqual(F.QUARTER);
  });

  it('stops at the extremes instead of wrapping', () => {
    expect(D.longer(F.WHOLE)).toEqual(F.WHOLE);
    expect(D.shorter(F.SIXTY_FOURTH)).toEqual(F.SIXTY_FOURTH);
  });

  it('preserves dots when changing the note value', () => {
    // A dotted quarter shortened is a dotted eighth, not a plain eighth.
    expect(D.shorter(F.dotted(F.QUARTER))).toEqual(F.dotted(F.EIGHTH));
  });

  it('preserves the tuplet when changing the note value', () => {
    const quarterTriplet = F.tuplet(F.QUARTER, 3, 2);
    expect(D.shorter(quarterTriplet)).toEqual(F.tuplet(F.EIGHTH, 3, 2));
  });
});

describe('dots and tuplets', () => {
  it('cycles undotted, dotted, double-dotted', () => {
    let d = F.QUARTER;
    d = D.cycleDots(d);
    expect(d).toEqual(F.dotted(F.QUARTER, 1));
    d = D.cycleDots(d);
    expect(d).toEqual(F.dotted(F.QUARTER, 2));
    d = D.cycleDots(d);
    expect(d).toEqual(F.QUARTER);
  });

  it('toggles a triplet on and off', () => {
    const on = D.toggleTriplet(F.EIGHTH);
    expect(on).toEqual(F.frac(1, 12));
    expect(D.toggleTriplet(on)).toEqual(F.EIGHTH);
  });
});

describe('labels', () => {
  it('names the common values', () => {
    expect(D.durationLabel(F.QUARTER)).toBe('Quarter');
    expect(D.durationLabel(F.dotted(F.EIGHTH))).toBe('Dotted 8th');
    expect(D.durationLabel(F.tuplet(F.EIGHTH, 3, 2))).toBe('8th triplet');
  });

  it('gives compact toolbar labels', () => {
    expect(D.durationShortLabel(F.WHOLE)).toBe('1');
    expect(D.durationShortLabel(F.QUARTER)).toBe('4');
    expect(D.durationShortLabel(F.SIXTEENTH)).toBe('16');
  });
});
