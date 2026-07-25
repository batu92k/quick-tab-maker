import { describe, expect, it } from 'vitest';
import { pageGeometry, printLayoutOptions, PAPER_SIZES } from './paper';

describe('pageGeometry', () => {
  it('keeps the score box inside the paper on both axes', () => {
    for (const id of ['a4', 'letter'] as const) {
      const g = pageGeometry(id);
      const paper = PAPER_SIZES[id];
      expect(g.scoreLeft).toBeGreaterThan(0);
      expect(g.scoreLeft + g.scoreWidth).toBeLessThanOrEqual(paper.w);
      expect(g.scoreTop).toBeGreaterThan(0);
      // Leaves room below the score for the footer and bottom margin.
      expect(g.scoreTop + g.scoreHeight).toBeLessThan(paper.h);
    }
  });

  it('gives Letter a wider, shorter box than A4', () => {
    const a4 = pageGeometry('a4');
    const letter = pageGeometry('letter');
    expect(letter.scoreWidth).toBeGreaterThan(a4.scoreWidth);
    expect(letter.scoreHeight).toBeLessThan(a4.scoreHeight);
  });
});

describe('printLayoutOptions', () => {
  it('sizes the layout to the page and keeps line spacing clear of the fret backdrop', () => {
    const o = printLayoutOptions('a4');
    const g = pageGeometry('a4');
    expect(o.width).toBe(g.scoreWidth);
    expect(o.pageHeight).toBe(g.scoreHeight);
    // Stacked chord digits overlap unless line spacing exceeds the backdrop
    // height, which is 1.24 x the font size.
    expect(o.lineSpacing!).toBeGreaterThan(o.fontSize! * 1.24);
  });

  it('passes extra options through, e.g. a forced bars-per-line', () => {
    expect(printLayoutOptions('a4', 'portrait', { barsPerSystem: 4 }).barsPerSystem).toBe(4);
  });

  it('swaps the box dimensions for landscape', () => {
    const portrait = pageGeometry('a4', 'portrait');
    const landscape = pageGeometry('a4', 'landscape');
    expect(landscape.scoreWidth).toBeGreaterThan(portrait.scoreWidth);
    expect(landscape.scoreHeight).toBeLessThan(portrait.scoreHeight);
  });
});
