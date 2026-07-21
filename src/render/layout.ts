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
import { DRUM_ROW_COUNT, rowForPiece } from '../theory/drums';

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
  // Room above the first staff for the track name and bar numbers, which are
  // drawn above the top staff line and would otherwise be clipped.
  marginTop: 34,
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
}

export interface LaidOutMeasure {
  readonly measure: Measure;
  readonly measureIndex: number;
  readonly x: number;
  readonly width: number;
  readonly beats: readonly LaidOutBeat[];
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

/**
 * Natural width of a measure, before it is stretched to fill a system.
 *
 * An empty measure still needs its minimum: a bar of rests is a real thing a
 * user clicks into, and collapsing it to nothing makes it unselectable.
 *
 * Space for one more beat is reserved only when the bar can actually take one.
 * A full 4/4 bar of eighths has no room for a ninth note, and reserving the
 * slot anyway draws a trailing gap that reads as an extra beat position the
 * user can fill — which they cannot.
 */
export function naturalMeasureWidth(
  song: Song,
  track: Track,
  measureIndex: number,
  o: LayoutOptions,
): number {
  const measure = track.measures[measureIndex];
  if (!measure) return o.minMeasureWidth;

  const content = measure.beats.reduce((sum, beat) => sum + beatWidth(beat.duration, o), 0);
  const append = hasRoomToAppend(song, track, measureIndex) ? o.beatBaseWidth : 0;
  return Math.max(o.minMeasureWidth, content + append + o.measurePadding * 2);
}

/** The widest natural width across tracks — all tracks share a bar grid. */
function sharedMeasureWidth(song: Song, measureIndex: number, o: LayoutOptions): number {
  return song.tracks.reduce(
    (max, track) => Math.max(max, naturalMeasureWidth(song, track, measureIndex, o)),
    o.minMeasureWidth,
  );
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
  const empty: LaidOutMeasure = {
    measure: measure ?? { id: `missing_${measureIndex}`, beats: [] },
    measureIndex,
    x,
    width,
    beats: [],
    appendX: x + pad + (o.beatBaseWidth * scale) / 2,
  };
  if (!measure) return empty;

  // Beat widths are scaled by the same factor as the bar, so the rhythm
  // spreads across the justified measure instead of bunching at the left.
  // Scaling every beat equally preserves their relative spacing, so a bar of
  // eighths still reads as evenly spaced and a dotted note still looks longer
  // than the note after it.
  let cursor = x + pad;
  const beats: LaidOutBeat[] = measure.beats.map((beat, beatIndex) => {
    const width = beatWidth(beat.duration, o) * scale;
    const centre = cursor + width / 2;
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
    const laidOut: LaidOutBeat = {
      beat,
      beatIndex,
      x: centre,
      left: cursor,
      width,
      notes,
      isRest: beat.notes.length === 0,
    };
    cursor += width;
    return laidOut;
  });

  return {
    ...empty,
    beats,
    appendX: cursor + (o.beatBaseWidth * scale) / 2,
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
  const widths = Array.from({ length: barCount }, (_, i) => sharedMeasureWidth(song, i, o));

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
        measures.push(layoutMeasure(track, i, x, width, staffTop, o, scale));
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
 * Interpolated across the beat columns rather than linearly across the bar,
 * because bar width is only *partly* proportional to duration — that is a
 * deliberate layout choice, and a playhead that ignores it slides visibly off
 * the notes it is supposed to be sounding. Inside a beat the motion is linear,
 * which is correct: nothing happens between two attacks.
 */
function playheadX(measure: LaidOutMeasure, offset: number, barDuration: number): number {
  let elapsed = 0;
  for (const beat of measure.beats) {
    const duration = F.toNumber(beat.beat.duration);
    if (offset < elapsed + duration) {
      return beat.left + ((offset - elapsed) / duration) * beat.width;
    }
    elapsed += duration;
  }

  // Past the last beat: the rest of the bar is empty, so spread what remains of
  // the musical time across what remains of the width.
  const tail = Math.max(barDuration - elapsed, 1e-6);
  const from = measure.beats.length > 0 ? lastEdge(measure) : measure.x;
  const width = Math.max(measure.x + measure.width - from, 0);
  return from + Math.min((offset - elapsed) / tail, 1) * width;
}

function lastEdge(measure: LaidOutMeasure): number {
  const last = measure.beats[measure.beats.length - 1];
  return last ? last.left + last.width : measure.x;
}

/**
 * Where to draw the playhead, spanning every staff of its system.
 *
 * `barDuration` comes from `measureDurations` rather than being recomputed here
 * so the playhead and the bar grid agree about how long a bar is even when a
 * time signature changes mid-song.
 */
export function playheadPosition(
  layout: Layout,
  bar: number,
  offset: number,
  barDuration: number,
): PlayheadGeometry | undefined {
  const o = layout.options;
  for (const system of layout.systems) {
    if (bar < system.firstMeasure || bar >= system.lastMeasure) continue;
    const staff = system.staves[0];
    const measure = staff?.measures.find((m) => m.measureIndex === bar);
    if (!measure) return undefined;
    return {
      x: playheadX(measure, offset, barDuration),
      y: system.y - o.lineSpacing / 2,
      height: system.height + o.lineSpacing,
    };
  }
  return undefined;
}

/** Musical time each bar occupies, exposed for the playhead and rulers. */
export function measureDurations(song: Song): Fraction[] {
  const barCount = song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);
  return Array.from({ length: barCount }, (_, i) => {
    const track = song.tracks[0];
    if (!track) {
      const sig = timeSignatureAt(song, i);
      return F.measureDuration(sig.num, sig.den);
    }
    return measureCapacity(song, track, i);
  });
}
