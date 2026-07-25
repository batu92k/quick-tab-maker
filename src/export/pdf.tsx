/**
 * PDF export.
 *
 * The song is laid out once with a page height, giving `layout.pages` — systems
 * grouped so none straddle a page boundary and each re-anchored to its page top.
 * Each page is rendered to an SVG (by the same renderer the screen uses) and
 * handed to svg2pdf; the title block, running header and page numbers are drawn
 * as PDF text around it.
 *
 * This module pulls in jspdf, svg2pdf and react-dom/server — all heavy — so it
 * is only ever imported dynamically, when the user actually exports.
 */

import { jsPDF } from 'jspdf';
import { renderToStaticMarkup } from 'react-dom/server';
import { svg2pdf } from 'svg2pdf.js';
import type { Song } from '../model/types';
import { layoutSong, type Layout } from '../render/layout';
import { PrintPage, type PrintAnnotation } from './PrintPage';
import {
  pageGeometry,
  PAPER_SIZES,
  printLayoutOptions,
  PRINT_TOKENS,
  type Orientation,
  type PageGeometry,
  type PaperId,
} from './paper';

export interface PdfOptions {
  readonly paper: PaperId;
  readonly orientation: Orientation;
  /**
   * Force exactly this many bars per line, or null to fit as many as the page
   * width allows. Falls back to the editor's cap when fitting.
   */
  readonly barsPerLine?: number | null;
  /** The editor's bars-per-line cap, applied only when `barsPerLine` is null. */
  readonly maxBarsPerSystem?: number | null;
}

function layoutExtras(opts: PdfOptions): Partial<import('../render/layout').LayoutOptions> {
  if (opts.barsPerLine != null) return { barsPerSystem: opts.barsPerLine };
  if (opts.maxBarsPerSystem != null) return { maxBarsPerSystem: opts.maxBarsPerSystem };
  return {};
}

/**
 * Places each annotation on its page in page-local coordinates.
 *
 * `layout.annotations` is positioned against the continuous (pre-pagination)
 * systems, so its y values must be shifted by however far pagination moved the
 * system they sit on. Flattening the pages' systems recovers the same order as
 * the continuous list, giving that shift per system.
 */
function perPageAnnotations(layout: Layout): PrintAnnotation[][] {
  const continuous = layout.systems;
  const shiftBySystem: { page: number; dy: number }[] = [];
  let index = 0;
  layout.pages.forEach((page, pageIndex) => {
    for (const system of page.systems) {
      const source = continuous[index];
      shiftBySystem[index] = { page: pageIndex, dy: source ? system.y - source.y : 0 };
      index++;
    }
  });

  const out: PrintAnnotation[][] = layout.pages.map(() => []);
  for (const a of layout.annotations) {
    const shift = shiftBySystem[a.systemIndex];
    if (!shift || !a.annotation.text.trim()) continue;
    out[shift.page]!.push({ text: a.annotation.text, x: a.x, y: a.y + shift.dy });
  }
  return out;
}

/**
 * Copies resolved styles onto elements as inline styles, and maps each font to
 * one of jsPDF's built-in families.
 *
 * svg2pdf can only render text in a font jsPDF knows; our tab and UI fonts are
 * not registered, so their glyphs come out as empty boxes. Rewriting the
 * font-family to 'courier'/'helvetica' fixes that without embedding font files.
 * Flattening fill/stroke at the same time makes the conversion independent of
 * how svg2pdf resolves stylesheet rules.
 */
function inlineStylesForPdf(root: SVGSVGElement): void {
  const props = [
    'fill',
    'stroke',
    'stroke-width',
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'font-size',
    'font-weight',
    'font-style',
  ] as const;

  const elements = [root, ...Array.from(root.querySelectorAll('*'))] as SVGElement[];
  for (const el of elements) {
    const cs = getComputedStyle(el);
    for (const p of props) {
      const value = cs.getPropertyValue(p);
      if (value) el.style.setProperty(p, value);
    }
    const family = cs.fontFamily.toLowerCase();
    const monospaced =
      family.includes('mono') || family.includes('jetbrains') || family.includes('courier');
    el.style.setProperty('font-family', monospaced ? 'courier' : 'helvetica');
  }
}

function drawChrome(
  doc: jsPDF,
  song: Song,
  geom: PageGeometry,
  pageIndex: number,
  total: number,
): void {
  const { paper, margin } = geom;
  const meta = `${song.key.tonic} ${song.key.mode} · ${song.tempoMap[0]?.bpm ?? '—'} BPM`;

  if (pageIndex === 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(18, 22, 28);
    doc.text(song.title || 'Untitled', margin, margin + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(91, 98, 107);
    let y = margin + 32;
    if (song.artist.trim()) {
      doc.text(song.artist, margin, y);
      y += 13;
    }
    doc.text(meta, margin, y);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 126, 134);
    doc.text(song.title || 'Untitled', margin, margin + 10);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 126, 134);
  doc.text(`Page ${pageIndex + 1} of ${total}`, paper.w / 2, paper.h - margin - 4, {
    align: 'center',
  });
}

/** Builds the document without saving it, so callers (and tests) can inspect it. */
export async function buildPdf(song: Song, opts: PdfOptions): Promise<jsPDF> {
  const geom = pageGeometry(opts.paper, opts.orientation);
  const layout = layoutSong(song, printLayoutOptions(opts.paper, opts.orientation, layoutExtras(opts)));
  const annotations = perPageAnnotations(layout);

  // jsPDF takes a portrait base format and arranges it by the orientation flag
  // (landscape → width = long side). geom.paper is already oriented and drives
  // our own drawing, so the two agree.
  const base = PAPER_SIZES[opts.paper];
  const format: [number, number] = [base.w, base.h];
  const doc = new jsPDF({ unit: 'pt', format, orientation: opts.orientation });

  // svg2pdf reads computed styles, so the SVG must be attached to the document.
  // The wrapper carries the print palette as custom properties and sits well
  // offscreen; it is always removed, even if a page throws.
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    opacity: '0',
    pointerEvents: 'none',
  });
  for (const [key, value] of Object.entries(PRINT_TOKENS)) wrapper.style.setProperty(key, value);
  document.body.appendChild(wrapper);

  try {
    const total = layout.pages.length;
    for (let i = 0; i < total; i++) {
      if (i > 0) doc.addPage(format, opts.orientation);
      drawChrome(doc, song, geom, i, total);

      wrapper.innerHTML = renderToStaticMarkup(
        <PrintPage
          page={layout.pages[i]!}
          options={layout.options}
          annotations={annotations[i]!}
          width={geom.scoreWidth}
          height={geom.scoreHeight}
        />,
      );
      const svg = wrapper.firstElementChild as unknown as SVGSVGElement;
      inlineStylesForPdf(svg);
      await svg2pdf(svg, doc, {
        x: geom.scoreLeft,
        y: geom.scoreTop,
        width: geom.scoreWidth,
        height: geom.scoreHeight,
      });
    }
  } finally {
    wrapper.remove();
  }

  return doc;
}

/** Filesystem-safe filename stem from the song title. */
function fileStem(song: Song): string {
  const cleaned = (song.title || 'song').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'song';
}

/** Builds and downloads the PDF. */
export async function exportSongToPdf(song: Song, opts: PdfOptions): Promise<void> {
  const doc = await buildPdf(song, opts);
  doc.save(`${fileStem(song)}.pdf`);
}
