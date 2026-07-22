/**
 * The layout engine: turns a song into positioned geometry.
 *
 * This is a pure function of (song, options) with no DOM and no React. Screen
 * rendering, click hit-testing and PDF export all consume its output, which is
 * what guarantees the printed page matches what the user was looking at — the
 * alternative, a separate print layout, drifts the moment either side changes.
 *
 * Coordinates are in abstract units that happen to be CSS pixels on screen and
 * are scaled to points for PDF. The origin is the top-left of the score.
 */

import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { measureCapacity, measureFilled, timeSignatureAt } from '../model/song';
import {
  isStringTrack,
  type AnyNote,
  type Beat,
  type DrumNote,
  type Measure,
  type Note,
  type Song,
  type TimeSignature,
  type Track,
} from '../model/types';
import { chordForStringBeat } from '../theory/chords';
import { DRUM_ROW_COUNT, rowForPiece } from '../theory/drums';
import { specOf } from '../theory/midi';

/* -------------------------------------------------------------------------- */
/* Options                                                                    */
/* -------------------------------------------------------------------------- */

export interface LayoutOptions {
  /** Total width available for the score, including margins. */
  readonly width: number;
  readonly marginX: number;
  readonly marginTop: number;
  /** Vertical gap between the string/row lines of one staff. */
  readonly lineSpacing: number;
  /** Gap between two tracks' staves within the same system. */
  readonly trackGap: number;
  /** Gap between systems. */
  readonly systemGap: number;
  /** Width reserved at the left of each system for track names and tuning. */
  readonly labelWidth: number;
  /** Smallest a measure may be squeezed to. */
  readonly minMeasureWidth: number;
  /** Horizontal room each beat gets before its duration is accounted for. */
  readonly beatBaseWidth: number;
  /**
   * Extra width per whole note of duration. Spacing is partly proportional to
   * duration so a bar of sixteenths reads as denser than a bar of quarters,
   * but only partly — fully proportional spacing wastes enormous horizontal
   * space on a whole note.
   */
  readonly beatDurationWidth: number;
  /** Padding inside a measure, before the first beat and after the last. */
  readonly measurePadding: number;
  readonly fontSize: number;
  /** Vertical room below a staff for duration stems. */
  readonly stemHeight: number;
  /** Optional page height; when set, systems are packed into pages for print. */
  readonly pageHeight?: number;
}

/** How far the final, partly-filled system may be stretched to justify. */
const LAST_SYSTEM_MAX_STRETCH = 2.5;

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  width: 1000,
  // Room above the first staff for the scrub ruler, chord names, the track name
  // and bar numbers, which all stack above the top staff line and would
  // otherwise be clipped. Later systems get the same stack from `systemGap`.
  marginTop: 46,
  marginX: 16,
  lineSpacing: 14,
  trackGap: 36,
  systemGap: 44,
  labelWidth: 44,
  minMeasureWidth: 90,
  beatBaseWidth: 22,
  beatDurationWidth: 90,
  measurePadding: 12,
  fontSize: 11,
  stemHeight: 18,
};

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

export interface LaidOutNote {
  readonly note: AnyNote;
  /** Centre of the glyph. */
  readonly x: number;
  readonly y: number;
  /** Fret number for string tracks; empty for drums, which use noteheads. */
  readonly text: string;
  /** String index, or drum staff row. */
  readonly line: number;
}

export interface LaidOutBeat {
  readonly beat: Beat;
  readonly beatIndex: number;
  /** Centre x of the beat's column. */
  readonly x: number;
  /** Left edge of the beat's clickable column. */
  readonly left: number;
  readonly width: number;
  readonly notes: readonly LaidOutNote[];
  readonly isRest: boolean;
  /**
   * Name of the chord this beat's notes spell, when they spell one — drawn
   * above the staff as a chord sheet would. Only string beats carry it; a beat
   * that names no chord leaves it undefined and nothing is drawn.
   */
  readonly chord?: string;
}

/** One instant in a bar, and the x every track draws it at. */
export interface MeasureColumn {
  /** Offset into the bar in whole notes. */
  readonly at: number;
  readonly x: number;
}

export interface LaidOutMeasure {
  readonly measure: Measure;
  readonly measureIndex: number;
  readonly x: number;
  readonly width: number;
  readonly beats: readonly LaidOutBeat[];
  /**
   * The bar's shared onset grid in screen coordinates. Every staff in the
   * system has the same one, which is what the playhead follows — it can then
   * be right about all tracks at once rather than about whichever staff it
   * happened to be handed.
   */
  readonly columns: readonly MeasureColumn[];
  /** Set when this measure introduces a new time signature. */
  readonly timeSigChange?: TimeSignature;
  /**
   * Where a beat appended to the end of this measure would sit. Editing needs
   * this: the cursor must be able to address the slot after the last note.
   */
  readonly appendX: number;
}

export interface LaidOutStaff {
  readonly track: Track;
  readonly trackIndex: number;
  /** Top of the staff's line block. */
  readonly y: number;
  /** y of each string/row line, top to bottom. */
  readonly lineYs: readonly number[];
  readonly height: number;
  readonly measures: readonly LaidOutMeasure[];
  /** Per-line labels at the left: string names, or drum abbreviations. */
  readonly lineLabels: readonly string[];
}

export interface LaidOutSystem {
  readonly y: number;
  readonly height: number;
  readonly firstMeasure: number;
  /** Exclusive. */
  readonly lastMeasure: number;
  readonly staves: readonly LaidOutStaff[];
  /** x where the staff lines start and end. */
  readonly contentLeft: number;
  readonly contentRight: number;
}

export interface LaidOutPage {
  readonly index: number;
  readonly systems: readonly LaidOutSystem[];
  readonly height: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly systems: readonly LaidOutSystem[];
  readonly pages: readonly LaidOutPage[];
  readonly options: LayoutOptions;
}

/* -------------------------------------------------------------------------- */
/* Measurement                                                                */
/* -------------------------------------------------------------------------- */

function beatWidth(duration: Fraction, o: LayoutOptions): number {
  return o.beatBaseWidth + o.beatDurationWidth * F.toNumber(duration);
}

/** Whether another note could still be added to this bar. */
export function hasRoomToAppend(song: Song, track: Track, measureIndex: number): boolean {
  const measure = track.measures[measureIndex];
  if (!measure) return false;
  return F.lt(measureFilled(measure), measureCapacity(song, track, measureIndex));
}

/* -------------------------------------------------------------------------- */
/* The shared rhythmic grid                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Where every track's notes may start within one bar, and the x each of those
 * instants gets.
 *
 * This is the thing that makes a multi-track score readable: two notes that
 * sound together must be drawn in one vertical column. Laying each track out
 * independently inside a shared bar width does not achieve that — a bar of
 * quarters and a bar of eighths both fill the bar, but their onsets land in
 * different places, so the bass drifts against the guitar and the playhead can
 * only ever be right about one of them.
 *
 * So the bar is divided once, at the union of every track's onsets, and each
 * track is positioned into that division. A guitar eighth and a bass quarter
 * beginning at the same instant then share an x by construction.
 *
 * The bar's own end is always a grid position. That is what gives a partly
 * filled bar its empty tail — the space a new note gets appended into — while a
 * bar that is full for every track ends exactly at its last note and grows no
 * phantom trailing slot.
 */
export interface MeasureGrid {
  /** Onsets in the bar, ascending, from zero to the bar's musical end. */
  readonly positions: readonly Fraction[];
  /** Unstretched x of each position, measured from the start of the content. */
  readonly xs: readonly number[];
  /** Total unstretched content width. */
  readonly width: number;
}

const key = (f: Fraction): string => `${f.n}/${f.d}`;

/** Musical capacity of a bar, from the track grid all tracks share. */
function barCapacity(song: Song, measureIndex: number): Fraction {
  const track = song.tracks[0];
  if (track) return measureCapacity(song, track, measureIndex);
  const sig = timeSignatureAt(song, measureIndex);
  return F.measureDuration(sig.num, sig.den);
}

export function measureGrid(song: Song, measureIndex: number, o: LayoutOptions): MeasureGrid {
  const seen = new Map<string, Fraction>([[key(F.ZERO), F.ZERO]]);
  const add = (f: Fraction): void => {
    seen.set(key(f), f);
  };

  for (const track of song.tracks) {
    for (const beat of track.measures[measureIndex]?.beats ?? []) {
      add(beat.start);
      // Both edges: a note's end is a column boundary even when no other track
      // happens to start something there.
      add(F.add(beat.start, beat.duration));
    }
  }
  add(barCapacity(song, measureIndex));

  const positions = [...seen.values()].sort(F.cmp);
  const xs: number[] = [0];
  for (let i = 1; i < positions.length; i++) {
    xs.push(xs[i - 1]! + beatWidth(F.sub(positions[i]!, positions[i - 1]!), o));
  }
  return { positions, xs, width: xs[xs.length - 1] ?? 0 };
}

/**
 * Half the column that starts at grid index `i`.
 *
 * Notes are drawn at their onset plus this, rather than at the centre of their
 * own duration. Centring is what breaks alignment: a quarter centred over its
 * own span sits between the two eighths it should be lining up with. Offsetting
 * every track by the same first-column half keeps a column a column.
 */
function halfColumn(grid: MeasureGrid, i: number): number {
  const next = grid.xs[i + 1];
  // The final position is the bar's end, which no note can start at. It gets no
  // offset, so it lands on the content edge instead of overshooting the bar
  // line by half a column and dragging the playhead out of its own measure.
  return next === undefined ? 0 : (next - grid.xs[i]!) / 2;
}

/**
 * Natural width of a measure, before it is stretched to fill a system.
 *
 * An empty measure still needs its minimum: a bar of rests is a real thing a
 * user clicks into, and collapsing it to nothing makes it unselectable.
 */
export function naturalMeasureWidth(song: Song, measureIndex: number, o: LayoutOptions): number {
  const grid = measureGrid(song, measureIndex, o);
  return Math.max(o.minMeasureWidth, grid.width + o.measurePadding * 2);
}

function staffLineCount(track: Track): number {
  return isStringTrack(track) ? track.tuning.length : DRUM_ROW_COUNT;
}

function staffHeight(track: Track, o: LayoutOptions): number {
  return (staffLineCount(track) - 1) * o.lineSpacing + o.stemHeight;
}

function lineLabels(track: Track): string[] {
  if (isStringTrack(track)) {
    // Tab is drawn highest string at the top, so the labels are reversed
    // relative to the tuning array, which is stored lowest-first.
    return [...track.tuning].reverse().map((pitch) => pitch.replace(/\d+$/, ''));
  }
  return ['CC', 'HH', 'RD', 'T1', 'T2', 'FT', 'SN', 'BD', 'HF'];
}

/**
 * Which visual line a note sits on.
 *
 * Tab convention puts the highest-pitched string on the top line, but the
 * document stores tuning lowest-first, so string index and line index run in
 * opposite directions. Getting this backwards silently mirrors every tab, so it
 * is isolated here and covered by tests.
 */
export function lineForNote(track: Track, note: AnyNote): number {
  if (isStringTrack(track)) {
    return track.tuning.length - 1 - (note as Note).string;
  }
  return rowForPiece((note as DrumNote).piece);
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

function layoutMeasure(
  track: Track,
  measureIndex: number,
  grid: MeasureGrid,
  x: number,
  width: number,
  staffTop: number,
  o: LayoutOptions,
  scale: number,
): LaidOutMeasure {
  const measure = track.measures[measureIndex];
  // Padding scales with the bar so the gap before the first beat and after the
  // last stay equal. Leaving it unscaled dumps the whole justification surplus
  // on the right-hand side, which reads as a trailing empty beat.
  const pad = o.measurePadding * scale;
  const contentLeft = x + pad;

  // Grid offsets are scaled by the same factor as the bar, so the rhythm
  // spreads across the justified measure instead of bunching at the left.
  // Scaling every column equally preserves their relative spacing, so a bar of
  // eighths still reads as evenly spaced and a dotted note still looks longer
  // than the note after it.
  const edgeAt = (i: number): number => contentLeft + grid.xs[i]! * scale;
  const columnAt = (i: number): number => edgeAt(i) + halfColumn(grid, i) * scale;

  const columns: MeasureColumn[] = grid.positions.map((position, i) => ({
    at: F.toNumber(position),
    x: columnAt(i),
  }));

  // Resolved once for the bar, not per beat: the fretboard spec is the same for
  // every note on the staff, and naming a chord costs a tonal analysis.
  const spec = isStringTrack(track) ? specOf(track) : null;

  const indexOf = new Map(grid.positions.map((p, i) => [key(p), i]));
  const empty: LaidOutMeasure = {
    measure: measure ?? { id: `missing_${measureIndex}`, beats: [] },
    measureIndex,
    x,
    width,
    beats: [],
    columns,
    appendX: columnAt(0),
  };
  if (!measure) return empty;

  let end = 0;
  const beats: LaidOutBeat[] = measure.beats.map((beat, beatIndex) => {
    const from = indexOf.get(key(beat.start)) ?? 0;
    const to = indexOf.get(key(F.add(beat.start, beat.duration))) ?? from + 1;
    end = to;

    // `left`/`width` span the note's whole sounding time, so clicking anywhere
    // under a long note selects it. `x` is the column, which is where the
    // notehead goes and where every other track's simultaneous note goes too.
    const left = edgeAt(from);
    const centre = columnAt(from);
    const notes: LaidOutNote[] = beat.notes.map((note) => {
      const line = lineForNote(track, note);
      return {
        note,
        x: centre,
        y: staffTop + line * o.lineSpacing,
        text: isStringTrack(track) ? String((note as Note).fret) : '',
        line,
      };
    });
    const chord = spec ? chordForStringBeat(spec, beat.notes as readonly Note[]) : null;
    return {
      beat,
      beatIndex,
      x: centre,
      left,
      width: Math.max(edgeAt(Math.min(to, grid.xs.length - 1)) - left, 0),
      notes,
      isRest: beat.notes.length === 0,
      ...(chord ? { chord } : {}),
    };
  });

  return {
    ...empty,
    beats,
    // The next note lands in the first free column. In a full bar that is the
    // bar's end, which carries no offset, so the cursor sits against the bar
    // line rather than beyond it.
    appendX: columnAt(Math.min(end, grid.positions.length - 1)),
    ...(measure.timeSig ? { timeSigChange: measure.timeSig } : {}),
  };
}

/**
 * Lays out an entire song.
 *
 * Measures are packed into systems greedily by width. Every track is laid out
 * with the same bar boundaries so a multi-track score stays readable vertically
 * — the shared width per bar is the widest any track needs.
 */
export function layoutSong(song: Song, options: Partial<LayoutOptions> = {}): Layout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const contentLeft = o.marginX + o.labelWidth;
  const contentRight = Math.max(contentLeft + o.minMeasureWidth, o.width - o.marginX);
  const available = contentRight - contentLeft;

  const barCount = song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
  const grids = Array.from({ length: barCount }, (_, i) => measureGrid(song, i, o));
  const widths = grids.map((grid) => Math.max(o.minMeasureWidth, grid.width + o.measurePadding * 2));

  // Greedy packing: fill a system until the next bar would overflow it.
  const rows: { first: number; last: number }[] = [];
  let first = 0;
  let used = 0;
  for (let i = 0; i < barCount; i++) {
    const w = widths[i]!;
    if (used > 0 && used + w > available) {
      rows.push({ first, last: i });
      first = i;
      used = 0;
    }
    used += w;
  }
  if (barCount > 0) rows.push({ first, last: barCount });

  const systems: LaidOutSystem[] = [];
  let y = o.marginTop;

  for (const row of rows) {
    const rowWidths = widths.slice(row.first, row.last);
    const naturalTotal = rowWidths.reduce((a, b) => a + b, 0);
    // Justify each system to the full width, never shrinking below natural size.
    const stretch = naturalTotal > 0 && naturalTotal < available ? available / naturalTotal : 1;
    // The final system is usually only partly full, and stretching two bars
    // across the page looks broken — but so does leaving a song that fits on a
    // single system hugging the left edge. Stretching it up to a limit handles
    // both: a nearly-full last line justifies, a nearly-empty one does not.
    const isLastRow = row.last === barCount;
    const scale = isLastRow ? Math.min(stretch, LAST_SYSTEM_MAX_STRETCH) : stretch;

    let staffTop = y;
    const staves: LaidOutStaff[] = song.tracks.map((track, trackIndex) => {
      const lines = staffLineCount(track);
      const lineYs = Array.from({ length: lines }, (_, i) => staffTop + i * o.lineSpacing);
      const measures: LaidOutMeasure[] = [];

      let x = contentLeft;
      for (let i = row.first; i < row.last; i++) {
        const width = widths[i]! * scale;
        measures.push(layoutMeasure(track, i, grids[i]!, x, width, staffTop, o, scale));
        x += width;
      }

      const staff: LaidOutStaff = {
        track,
        trackIndex,
        y: staffTop,
        lineYs,
        height: staffHeight(track, o),
        measures,
        lineLabels: lineLabels(track),
      };
      staffTop += staff.height + o.trackGap;
      return staff;
    });

    const height = staffTop - y - o.trackGap;
    systems.push({
      y,
      height,
      firstMeasure: row.first,
      lastMeasure: row.last,
      staves,
      contentLeft,
      contentRight: contentLeft + rowWidths.reduce((a, b) => a + b, 0) * scale,
    });
    y += height + o.systemGap;
  }

  const height = Math.max(y - o.systemGap + o.marginTop, o.marginTop * 2);
  return {
    width: o.width,
    height,
    systems,
    pages: paginate(systems, o),
    options: o,
  };
}

/**
 * Groups systems into pages for printing.
 *
 * Without a `pageHeight` the score is one continuous page, which is what the
 * on-screen editor wants. PDF export supplies a height and gets page breaks
 * that never split a system across a boundary.
 */
function paginate(systems: readonly LaidOutSystem[], o: LayoutOptions): LaidOutPage[] {
  const pageHeight = o.pageHeight;
  if (!pageHeight) {
    const height = systems.reduce((max, s) => Math.max(max, s.y + s.height), 0) + o.marginTop;
    return [{ index: 0, systems, height }];
  }

  const pages: LaidOutPage[] = [];
  let current: LaidOutSystem[] = [];
  let offset = o.marginTop;

  for (const system of systems) {
    const needed = system.height + o.systemGap;
    if (current.length > 0 && offset + needed > pageHeight - o.marginTop) {
      pages.push({ index: pages.length, systems: current, height: pageHeight });
      current = [];
      offset = o.marginTop;
    }
    // Systems are re-anchored to the top of their page, so a page renders
    // standalone without the caller subtracting a running offset.
    current.push({ ...system, y: offset });
    offset += needed;
  }
  if (current.length > 0) pages.push({ index: pages.length, systems: current, height: pageHeight });
  return pages;
}

/* -------------------------------------------------------------------------- */
/* Hit testing                                                                */
/* -------------------------------------------------------------------------- */

export interface HitResult {
  readonly trackId: string;
  readonly measureIndex: number;
  /** Index of the beat hit, or the append slot past the last beat. */
  readonly beatIndex: number;
  readonly line: number;
}

/**
 * Maps a click in score coordinates to an editing position.
 *
 * Returns the append slot when the click lands past the last beat of a bar,
 * so clicking empty space at the end of a measure starts a new note there —
 * the most common way a user extends a bar.
 */
export function hitTest(layout: Layout, x: number, y: number): HitResult | undefined {
  const o = layout.options;

  for (const system of layout.systems) {
    for (const staff of system.staves) {
      const top = staff.y - o.lineSpacing / 2;
      const bottom = staff.y + (staff.lineYs.length - 1) * o.lineSpacing + o.lineSpacing / 2;
      if (y < top || y > bottom) continue;

      const line = Math.min(
        staff.lineYs.length - 1,
        Math.max(0, Math.round((y - staff.y) / o.lineSpacing)),
      );

      for (const measure of staff.measures) {
        if (x < measure.x || x > measure.x + measure.width) continue;

        for (const beat of measure.beats) {
          if (x >= beat.left && x < beat.left + beat.width) {
            return {
              trackId: staff.track.id,
              measureIndex: measure.measureIndex,
              beatIndex: beat.beatIndex,
              line,
            };
          }
        }
        return {
          trackId: staff.track.id,
          measureIndex: measure.measureIndex,
          beatIndex: measure.beats.length,
          line,
        };
      }
    }
  }
  return undefined;
}

/** Screen position of an editing cursor, for drawing the caret. */
export function cursorPosition(
  layout: Layout,
  trackId: string,
  measureIndex: number,
  beatIndex: number,
  line: number,
): { x: number; y: number } | undefined {
  for (const system of layout.systems) {
    for (const staff of system.staves) {
      if (staff.track.id !== trackId) continue;
      const measure = staff.measures.find((m) => m.measureIndex === measureIndex);
      if (!measure) continue;
      const beat = measure.beats[beatIndex];
      const x = beat ? beat.x : measure.appendX;
      return { x, y: staff.y + line * layout.options.lineSpacing };
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Playhead                                                                   */
/* -------------------------------------------------------------------------- */

export interface PlayheadGeometry {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/**
 * Horizontal position of a musical offset inside a laid-out bar.
 *
 * Interpolated across the bar's shared onset grid rather than linearly across
 * its width, because bar width is only *partly* proportional to duration — that
 * is a deliberate layout choice, and a playhead that ignores it slides off the
 * notes it is supposed to be sounding. Between two onsets the motion is linear,
 * which is correct: nothing happens between two attacks.
 *
 * Because the grid is shared, landing on a column means landing on every
 * track's note at that instant, not just the top staff's.
 */
export function offsetToX(measure: LaidOutMeasure, offset: number): number {
  const columns = measure.columns;
  const first = columns[0];
  if (!first) return measure.x;
  if (offset <= first.at) return first.x;

  for (let i = 1; i < columns.length; i++) {
    const to = columns[i]!;
    if (offset < to.at) {
      const from = columns[i - 1]!;
      const span = to.at - from.at;
      return span <= 0 ? from.x : from.x + ((offset - from.at) / span) * (to.x - from.x);
    }
  }
  return columns[columns.length - 1]!.x;
}

/**
 * The offset a score x maps to inside a laid-out bar — the inverse of
 * `offsetToX`, used to scrub the playhead to where a pointer landed. Continuous
 * between onsets, matching the interpolation the playhead draws with, so the
 * place a click lands and the place the line then sits are the same.
 */
function offsetAtX(measure: LaidOutMeasure, x: number): number {
  const columns = measure.columns;
  const first = columns[0];
  if (!first) return 0;
  if (x <= first.x) return first.at;

  for (let i = 1; i < columns.length; i++) {
    const to = columns[i]!;
    if (x < to.x) {
      const from = columns[i - 1]!;
      const span = to.x - from.x;
      return span <= 0 ? from.at : from.at + ((x - from.x) / span) * (to.at - from.at);
    }
  }
  return columns[columns.length - 1]!.at;
}

/** Where to draw the playhead, spanning every staff of its system. */
export function playheadPosition(
  layout: Layout,
  bar: number,
  offset: number,
): PlayheadGeometry | undefined {
  const o = layout.options;
  for (const system of layout.systems) {
    if (bar < system.firstMeasure || bar >= system.lastMeasure) continue;
    const staff = system.staves[0];
    const measure = staff?.measures.find((m) => m.measureIndex === bar);
    if (!measure) return undefined;
    return {
      x: offsetToX(measure, offset),
      y: system.y - o.lineSpacing / 2,
      height: system.height + o.lineSpacing,
    };
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Scrub ruler                                                                */
/* -------------------------------------------------------------------------- */

export interface RulerBand {
  /** y of the ruler's baseline line. */
  readonly line: number;
  /** Top and bottom of the clickable strip, above the top staff. */
  readonly top: number;
  readonly bottom: number;
}

/**
 * The scrub ruler's vertical geometry above a system's top staff. Shared by the
 * renderer, which draws the ticks here, and the hit test, which decides a click
 * belongs to the ruler rather than to a note — so the strip you see is exactly
 * the strip that scrubs. The bottom stops just short of the staff's own click
 * region, so it never swallows a click meant for the top string.
 */
export function rulerBand(systemY: number, o: LayoutOptions): RulerBand {
  const line = systemY - o.lineSpacing * 1.6;
  return { line, top: line - 9, bottom: systemY - o.lineSpacing * 0.55 };
}

export interface ScrubTarget {
  readonly bar: number;
  /** Continuous whole-note offset into the bar. */
  readonly offset: number;
}

/**
 * Maps a click on the ruler to a musical position, for scrubbing the playhead.
 *
 * Returns undefined unless the point lands in some system's ruler band, which
 * is how the caller tells a scrub from an edit without a separate surface. The x
 * is clamped into the system's content, so a click in the ruler's margins still
 * grabs the nearest end of the bar rather than nothing.
 */
export function positionAtX(layout: Layout, x: number, y: number): ScrubTarget | undefined {
  const o = layout.options;
  for (const system of layout.systems) {
    const band = rulerBand(system.y, o);
    if (y < band.top || y > band.bottom) continue;

    const staff = system.staves[0];
    if (!staff) return undefined;
    const clampedX = Math.min(Math.max(x, system.contentLeft), system.contentRight);

    let target = staff.measures[0];
    for (const measure of staff.measures) {
      target = measure;
      if (clampedX < measure.x + measure.width) break;
    }
    if (!target) return undefined;
    return { bar: target.measureIndex, offset: offsetAtX(target, clampedX) };
  }
  return undefined;
}

