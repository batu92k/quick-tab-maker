/**
 * Print geometry and palette for PDF export.
 *
 * Everything here is in PostScript points (1/72 inch), jsPDF's default unit.
 * The score layout is computed directly in points too, so a `fontSize` of 11
 * means 11pt on the page and nothing is scaled — svg2pdf places the SVG 1:1.
 */

import type { LayoutOptions } from '../render/layout';
import type { PaperSize } from '../settings/settings';

export type PaperId = PaperSize;
export type Orientation = 'portrait' | 'landscape';

export interface PaperDimensions {
  readonly label: string;
  readonly w: number;
  readonly h: number;
}

// Portrait dimensions in points.
export const PAPER_SIZES: Record<PaperId, PaperDimensions> = {
  a4: { label: 'A4', w: 595.28, h: 841.89 },
  letter: { label: 'Letter', w: 612, h: 792 },
};

/** Paper dimensions with orientation applied — landscape swaps width and height. */
export function paperDimensions(paper: PaperId, orientation: Orientation): PaperDimensions {
  const p = PAPER_SIZES[paper];
  return orientation === 'landscape' ? { label: p.label, w: p.h, h: p.w } : p;
}

// Fixed print chrome. The title block is reserved on every page so pagination
// can use one page height; page 1 fills it, later pages leave it mostly blank.
const MARGIN = 40;
const TITLE_BLOCK = 54;
const FOOTER = 20;
// Blank band inside the score SVG above the first staff, for chord names, bar
// numbers and annotations. Must exceed the annotation lane (3.5 lineSpacings ≈
// 49pt at the default line spacing).
const SCORE_MARGIN_TOP = 52;

export interface PageGeometry {
  readonly paper: PaperDimensions;
  readonly margin: number;
  readonly scoreLeft: number;
  readonly scoreTop: number;
  readonly scoreWidth: number;
  /** Height budget for the score SVG on each page. */
  readonly scoreHeight: number;
}

export function pageGeometry(paper: PaperId, orientation: Orientation = 'portrait'): PageGeometry {
  const p = paperDimensions(paper, orientation);
  const scoreTop = MARGIN + TITLE_BLOCK;
  const scoreBottom = p.h - MARGIN - FOOTER;
  return {
    paper: p,
    margin: MARGIN,
    scoreLeft: MARGIN,
    scoreTop,
    scoreWidth: p.w - MARGIN * 2,
    scoreHeight: scoreBottom - scoreTop,
  };
}

/**
 * Layout options that make `layoutSong` paginate to the chosen paper.
 *
 * Print gets tighter vertical rhythm than the screen: the editor's generous
 * track and system gaps leave a portrait page holding a single tall multi-track
 * system, wasting most of the sheet. Narrower bars (less duration-proportional
 * width) also pack more bars onto each line, so a short song stays on one page.
 */
export function printLayoutOptions(
  paper: PaperId,
  orientation: Orientation = 'portrait',
  extra: Partial<LayoutOptions> = {},
): Partial<LayoutOptions> {
  const g = pageGeometry(paper, orientation);
  return {
    width: g.scoreWidth,
    pageHeight: g.scoreHeight,
    marginTop: SCORE_MARGIN_TOP,
    // Compact vertical rhythm: three stacked tracks per system are tall, so a
    // little less line spacing and smaller gaps let two systems share a page.
    // Line spacing must stay above the fret-number backdrop height (1.24 ×
    // fontSize) or stacked chord digits overlap and clip each other.
    fontSize: 9,
    lineSpacing: 12,
    stemHeight: 13,
    trackGap: 18,
    systemGap: 24,
    minMeasureWidth: 66,
    beatBaseWidth: 18,
    beatDurationWidth: 54,
    // Text notes sit just above the staff — the on-screen lane clears a scrub
    // ruler that the print does not have, and its full height would reach up
    // into the previous system across the tighter print gap.
    annotationLane: 1.8,
    ...extra,
  };
}

/**
 * A fixed light palette so the PDF prints cleanly regardless of the on-screen
 * theme. Set as custom properties on the offscreen render wrapper; the score's
 * class-based colours resolve against them through the cascade.
 */
export const PRINT_TOKENS: Record<string, string> = {
  '--qtm-bg': '#ffffff',
  '--qtm-surface': '#ffffff',
  '--qtm-text': '#12161c',
  '--qtm-note': '#12161c',
  '--qtm-text-muted': '#5b626b',
  '--qtm-staff-line': '#a7adb6',
  '--qtm-barline': '#4a515a',
  '--qtm-accent': '#0b6b62',
};
