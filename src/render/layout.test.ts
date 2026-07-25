import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import * as E from '../model/edit';
import * as F from '../model/fraction';
import { demoSong } from '../model/fixtures';
import { createDrumTrack, createSong, createStringTrack } from '../model/song';
import { isStringTrack, type Song } from '../model/types';
import { DRUM_ROW_COUNT, rowForPiece } from '../theory/drums';
import {
  DEFAULT_LAYOUT_OPTIONS,
  cursorPosition,
  hasRoomToAppend,
  hitTest,
  layoutSong,
  lineForNote,
  naturalMeasureWidth,
  offsetToX,
  playheadPosition,
  positionAtX,
  rulerBand,
} from './layout';

const guitarOnly = (measureCount = 4): Song =>
  createSong({ tracks: [createStringTrack('guitar', { measureCount })] });

/** Guitar in eighths over bass in quarters — the ordinary multi-track case. */
const mixedRhythms = (): Song =>
  produce(
    createSong({
      tracks: [
        createStringTrack('guitar', { measureCount: 1 }),
        createStringTrack('bass', { measureCount: 1 }),
      ],
    }),
    (d) => {
      const guitar = d.tracks[0]!.id;
      const bass = d.tracks[1]!.id;
      for (let i = 0; i < 8; i++) E.setNote(d, guitar, 0, i, 0, 0, F.EIGHTH);
      for (let i = 0; i < 4; i++) E.setNote(d, bass, 0, i, 0, 0, F.QUARTER);
    },
  );

describe('lineForNote', () => {
  it('draws the highest string on the top line', () => {
    const song = guitarOnly();
    const track = song.tracks[0]!;
    if (!isStringTrack(track)) throw new Error('expected a string track');

    // Tuning is stored lowest-first, but tab is drawn highest-first, so the
    // two indices run in opposite directions. Mixing them up mirrors the tab.
    const highE = { id: 'n', string: 5, fret: 0, techniques: [] };
    const lowE = { id: 'n', string: 0, fret: 0, techniques: [] };
    expect(lineForNote(track, highE)).toBe(0); // top line
    expect(lineForNote(track, lowE)).toBe(5); // bottom line
  });

  it('handles a 4-string bass', () => {
    const song = createSong({ tracks: [createStringTrack('bass')] });
    const track = song.tracks[0]!;
    expect(lineForNote(track, { id: 'n', string: 3, fret: 0, techniques: [] })).toBe(0);
    expect(lineForNote(track, { id: 'n', string: 0, fret: 0, techniques: [] })).toBe(3);
  });

  it('places drum pieces on their staff rows', () => {
    const song = createSong({ tracks: [createDrumTrack()] });
    const track = song.tracks[0]!;
    const line = (piece: 'kick' | 'snare' | 'crash') =>
      lineForNote(track, { id: 'n', piece, articulation: 'normal' });

    expect(line('crash')).toBe(rowForPiece('crash'));
    expect(line('snare')).toBe(rowForPiece('snare'));
    // Cymbals sit above the snare, which sits above the kick.
    expect(line('crash')).toBeLessThan(line('snare'));
    expect(line('snare')).toBeLessThan(line('kick'));
  });
});

describe('measure widths', () => {
  it('never collapses an empty measure below the minimum', () => {
    const song = guitarOnly();
    const width = naturalMeasureWidth(song, 0, DEFAULT_LAYOUT_OPTIONS);
    expect(width).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.minMeasureWidth);
  });

  it('reserves no append slot in a bar that is already full', () => {
    // Regression: every bar reserved room for one more beat, so a full 4/4 bar
    // of eight eighth notes drew a ninth empty slot the user could never fill.
    const song = produce(guitarOnly(), (d) => {
      const id = d.tracks[0]!.id;
      for (let i = 0; i < 8; i++) E.setNote(d, id, 0, i, 0, i, F.EIGHTH); // bar 0: full
      for (let i = 0; i < 7; i++) E.setNote(d, id, 1, i, 0, i, F.EIGHTH); // bar 1: room left
    });
    const track = song.tracks[0]!;

    expect(hasRoomToAppend(song, track, 0)).toBe(false);
    expect(hasRoomToAppend(song, track, 1)).toBe(true);

    // The full bar is exactly its content plus padding — no trailing slot.
    const full = naturalMeasureWidth(song, 0, DEFAULT_LAYOUT_OPTIONS);
    const contentWidth = 8 * (DEFAULT_LAYOUT_OPTIONS.beatBaseWidth + DEFAULT_LAYOUT_OPTIONS.beatDurationWidth / 8);
    expect(full).toBeCloseTo(contentWidth + DEFAULT_LAYOUT_OPTIONS.measurePadding * 2);
  });

  it('pads a full bar symmetrically, with no trailing beat-sized gap', () => {
    const song = produce(guitarOnly(), (d) => {
      const id = d.tracks[0]!.id;
      for (let i = 0; i < 8; i++) E.setNote(d, id, 0, i, 0, i, F.EIGHTH);
    });
    const measure = layoutSong(song, { width: 2400 }).systems[0]!.staves[0]!.measures[0]!;
    const first = measure.beats[0]!;
    const last = measure.beats[measure.beats.length - 1]!;

    const leading = first.left - measure.x;
    const trailing = measure.x + measure.width - (last.left + last.width);
    // Justification surplus must be split evenly, not dumped after the last
    // note where it reads as an extra empty beat.
    expect(trailing).toBeCloseTo(leading, 1);
  });

  it('still reserves an append slot in a bar with room', () => {
    const song = produce(guitarOnly(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, F.QUARTER);
    });
    const withRoom = naturalMeasureWidth(song, 0, DEFAULT_LAYOUT_OPTIONS);
    const beatOnly =
      DEFAULT_LAYOUT_OPTIONS.beatBaseWidth + DEFAULT_LAYOUT_OPTIONS.beatDurationWidth / 4;
    expect(withRoom).toBeGreaterThan(beatOnly + DEFAULT_LAYOUT_OPTIONS.measurePadding * 2);
  });

  it('gives a denser bar more room than a sparse one', () => {
    const song = produce(guitarOnly(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 1, F.QUARTER); // one quarter
      for (let i = 0; i < 8; i++) E.setNote(d, id, 1, i, 0, i, F.EIGHTH); // eight eighths
    });
    const sparse = naturalMeasureWidth(song, 0, DEFAULT_LAYOUT_OPTIONS);
    const dense = naturalMeasureWidth(song, 1, DEFAULT_LAYOUT_OPTIONS);
    expect(dense).toBeGreaterThan(sparse);
  });
});

describe('layoutSong', () => {
  it('lays out every track of every bar', () => {
    const song = demoSong();
    const layout = layoutSong(song, { width: 2400 }); // wide enough for one system

    expect(layout.systems).toHaveLength(1);
    const system = layout.systems[0]!;
    expect(system.staves).toHaveLength(3); // guitar, bass, drums
    expect(system.staves[0]!.measures).toHaveLength(4);
  });

  it('gives each staff the right number of lines', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    const [guitar, bass, drums] = layout.systems[0]!.staves;
    expect(guitar!.lineYs).toHaveLength(6);
    expect(bass!.lineYs).toHaveLength(4);
    expect(drums!.lineYs).toHaveLength(DRUM_ROW_COUNT);
  });

  it('wraps into multiple systems when the width runs out', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 12 })] });
    const narrow = layoutSong(song, { width: 400 });
    const wide = layoutSong(song, { width: 4000 });

    expect(narrow.systems.length).toBeGreaterThan(wide.systems.length);
    // Every bar appears exactly once, regardless of wrapping.
    const bars = narrow.systems.flatMap((s) => s.staves[0]!.measures.map((m) => m.measureIndex));
    expect(bars).toEqual([...Array(12).keys()]);
  });

  it('caps bars per system when asked, even with room to spare', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 14 })] });
    // Wide enough to hold all 14 bars on one line; the cap must still break it.
    const layout = layoutSong(song, { width: 6000, maxBarsPerSystem: 6 });

    expect(layout.systems.map((s) => s.staves[0]!.measures.length)).toEqual([6, 6, 2]);
    // Every bar still appears exactly once, in order.
    const bars = layout.systems.flatMap((s) => s.staves[0]!.measures.map((m) => m.measureIndex));
    expect(bars).toEqual([...Array(14).keys()]);
  });

  it('forces an exact bar count per system, shrinking to fit if need be', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 9 })] });
    // A narrow page can't fit three bars naturally, but a forced count must.
    const layout = layoutSong(song, { width: 360, barsPerSystem: 3 });

    expect(layout.systems.map((s) => s.staves[0]!.measures.length)).toEqual([3, 3, 3]);
    // Every bar appears once, in order.
    const bars = layout.systems.flatMap((s) => s.staves[0]!.measures.map((m) => m.measureIndex));
    expect(bars).toEqual([...Array(9).keys()]);
  });

  it('stacks systems downward without overlapping', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 12 })] });
    const layout = layoutSong(song, { width: 500 });
    for (let i = 1; i < layout.systems.length; i++) {
      const prev = layout.systems[i - 1]!;
      const next = layout.systems[i]!;
      expect(next.y).toBeGreaterThanOrEqual(prev.y + prev.height);
    }
  });

  it('stacks tracks within a system without overlapping', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    const staves = layout.systems[0]!.staves;
    for (let i = 1; i < staves.length; i++) {
      expect(staves[i]!.y).toBeGreaterThan(staves[i - 1]!.y + staves[i - 1]!.height - 1);
    }
  });

  it('keeps bars aligned across tracks', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    const [guitar, bass, drums] = layout.systems[0]!.staves;
    for (let i = 0; i < 4; i++) {
      expect(bass!.measures[i]!.x).toBeCloseTo(guitar!.measures[i]!.x);
      expect(drums!.measures[i]!.x).toBeCloseTo(guitar!.measures[i]!.x);
      expect(bass!.measures[i]!.width).toBeCloseTo(guitar!.measures[i]!.width);
    }
  });

  it('orders beats left to right within a bar', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    const beats = layout.systems[0]!.staves[0]!.measures[0]!.beats;
    expect(beats.length).toBeGreaterThan(1);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]!.x).toBeGreaterThan(beats[i - 1]!.x);
    }
  });

  it('positions chord notes in one column at different heights', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    // Bar 2 of the guitar opens with a six-note Em chord.
    const chord = layout.systems[0]!.staves[0]!.measures[1]!.beats[0]!;
    expect(chord.notes).toHaveLength(6);
    const xs = new Set(chord.notes.map((n) => n.x));
    const ys = new Set(chord.notes.map((n) => n.y));
    expect(xs.size).toBe(1); // same column
    expect(ys.size).toBe(6); // six distinct lines
  });

  it('marks empty beats as rests', () => {
    const song = produce(guitarOnly(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 2, 0, 5, F.QUARTER); // pads beats 0 and 1 with rests
    });
    const beats = layoutSong(song, { width: 2400 }).systems[0]!.staves[0]!.measures[0]!.beats;
    expect(beats.map((b) => b.isRest)).toEqual([true, true, false]);
  });

  it('justifies a song that fits on a single system to the full width', () => {
    // Regression: the last system was exempt from justification, which meant a
    // short song — where the only system is also the last — never stretched and
    // sat hugging the left edge of the page.
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 4 })] });
    const layout = layoutSong(song, { width: 1200 });

    expect(layout.systems).toHaveLength(1);
    const system = layout.systems[0]!;
    expect(system.contentRight).toBeGreaterThan(system.contentLeft + 700);
  });

  it('does not stretch a nearly-empty final system across the page', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 13 })] });
    const layout = layoutSong(song, { width: 700 });
    const last = layout.systems[layout.systems.length - 1]!;
    const first = layout.systems[0]!;

    // The trailing system holds fewer bars, so it is allowed to end short
    // rather than blowing one bar up to full width.
    expect(last.staves[0]!.measures.length).toBeLessThan(first.staves[0]!.measures.length);
    expect(last.contentRight).toBeLessThanOrEqual(first.contentRight + 1);
  });

  it('leaves room above the first staff for labels drawn above it', () => {
    // Regression: the track name is drawn above the top staff line, and with a
    // small top margin it was clipped off the top of the SVG.
    const layout = layoutSong(demoSong(), { width: 1200 });
    const staff = layout.systems[0]!.staves[0]!;
    expect(staff.y).toBeGreaterThanOrEqual(layout.options.lineSpacing * 2);
  });

  it('reports a height that covers all its content', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 12 })] });
    const layout = layoutSong(song, { width: 500 });
    const last = layout.systems[layout.systems.length - 1]!;
    expect(layout.height).toBeGreaterThanOrEqual(last.y + last.height);
  });

  it('handles a song whose bars are all empty', () => {
    const layout = layoutSong(guitarOnly(2), { width: 800 });
    expect(layout.systems).toHaveLength(1);
    expect(layout.systems[0]!.staves[0]!.measures).toHaveLength(2);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe('pagination', () => {
  it('is a single continuous page when no page height is given', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 40 })] });
    expect(layoutSong(song, { width: 800 }).pages).toHaveLength(1);
  });

  it('breaks into pages without splitting a system', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 40 })] });
    const layout = layoutSong(song, { width: 800, pageHeight: 500 });

    expect(layout.pages.length).toBeGreaterThan(1);
    // Every system lands on exactly one page, and fits inside it.
    const placed = layout.pages.flatMap((p) => p.systems);
    expect(placed).toHaveLength(layout.systems.length);
    for (const page of layout.pages) {
      for (const system of page.systems) {
        expect(system.y + system.height).toBeLessThanOrEqual(page.height);
      }
    }
  });
});

describe('hitTest', () => {
  it('finds the beat under a click', () => {
    const song = demoSong();
    const layout = layoutSong(song, { width: 2400 });
    const beat = layout.systems[0]!.staves[0]!.measures[0]!.beats[2]!;

    const hit = hitTest(layout, beat.x, layout.systems[0]!.staves[0]!.y);
    expect(hit).toMatchObject({
      trackId: song.tracks[0]!.id,
      measureIndex: 0,
      beatIndex: 2,
      line: 0,
    });
  });

  it('resolves the line from the vertical position', () => {
    const song = demoSong();
    const layout = layoutSong(song, { width: 2400 });
    const staff = layout.systems[0]!.staves[0]!;
    const beat = staff.measures[0]!.beats[0]!;

    const third = hitTest(layout, beat.x, staff.lineYs[2]!);
    expect(third?.line).toBe(2);
  });

  it('returns the append slot when clicking past the last beat', () => {
    const song = produce(guitarOnly(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, F.QUARTER);
    });
    const layout = layoutSong(song, { width: 2400 });
    const measure = layout.systems[0]!.staves[0]!.measures[0]!;

    const hit = hitTest(layout, measure.x + measure.width - 2, layout.systems[0]!.staves[0]!.y);
    expect(hit?.beatIndex).toBe(1); // one past the only beat
  });

  it('picks the right track when several are stacked', () => {
    const song = demoSong();
    const layout = layoutSong(song, { width: 2400 });
    const bass = layout.systems[0]!.staves[1]!;

    const hit = hitTest(layout, bass.measures[0]!.beats[0]!.x, bass.y);
    expect(hit?.trackId).toBe(song.tracks[1]!.id);
  });

  it('misses cleanly outside any staff', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    expect(hitTest(layout, -100, -100)).toBeUndefined();
    expect(hitTest(layout, 50, 100_000)).toBeUndefined();
  });

  it('round-trips against cursorPosition', () => {
    const song = demoSong();
    const layout = layoutSong(song, { width: 2400 });
    const trackId = song.tracks[0]!.id;

    for (const beatIndex of [0, 1, 3]) {
      const pos = cursorPosition(layout, trackId, 0, beatIndex, 2)!;
      expect(pos).toBeDefined();
      expect(hitTest(layout, pos.x, pos.y)).toMatchObject({ trackId, measureIndex: 0, beatIndex, line: 2 });
    }
  });
});

describe('cursorPosition', () => {
  it('falls back to the append slot past the last beat', () => {
    const song = produce(guitarOnly(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, F.QUARTER);
    });
    const layout = layoutSong(song, { width: 2400 });
    const measure = layout.systems[0]!.staves[0]!.measures[0]!;

    const pos = cursorPosition(layout, song.tracks[0]!.id, 0, 5, 0)!;
    expect(pos.x).toBeCloseTo(measure.appendX);
  });

  it('returns nothing for an unknown track', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    expect(cursorPosition(layout, 'nope', 0, 0, 0)).toBeUndefined();
  });
});

describe('playheadPosition', () => {
  /** Four quarter notes in bar 0, so every beat column is addressable. */
  const withBeats = (): Song =>
    produce(guitarOnly(), (d) => {
      for (let i = 0; i < 4; i++) E.setNote(d, d.tracks[0]!.id, 0, i, 0, i, F.QUARTER);
    });

  it('sits on a note when the offset is that note’s start', () => {
    const song = withBeats();
    const layout = layoutSong(song, { width: 2400 });
    const beats = layout.systems[0]!.staves[0]!.measures[0]!.beats;

    for (const [i, beat] of beats.entries()) {
      const head = playheadPosition(layout, 0, i * 0.25)!;
      // On the notehead itself, not the left edge of its column: the point of
      // the playhead is to say "this note, now".
      expect(head.x).toBeCloseTo(beat.x);
    }
  });

  it('moves left to right within a beat', () => {
    const layout = layoutSong(withBeats(), { width: 2400 });
    const early = playheadPosition(layout, 0, 0.02)!;
    const late = playheadPosition(layout, 0, 0.2)!;
    expect(late.x).toBeGreaterThan(early.x);
  });

  it('crosses beat columns rather than sliding evenly across the bar', () => {
    // Bar width is only partly proportional to duration, so a playhead that
    // interpolated across the whole bar would drift off the notes it is
    // sounding. Half way through the bar must land on the third quarter.
    const layout = layoutSong(withBeats(), { width: 2400 });
    const third = layout.systems[0]!.staves[0]!.measures[0]!.beats[2]!;
    expect(playheadPosition(layout, 0, 0.5)!.x).toBeCloseTo(third.x);
  });

  it('is right about every track at once, not just the top staff', () => {
    // The regression this whole grid exists for: the playhead followed staff 0,
    // so on a song whose bass moves in quarters against a guitar in eighths it
    // was visibly wrong about the bass on every beat.
    const layout = layoutSong(mixedRhythms(), { width: 2400 });
    const [guitar, bass] = layout.systems[0]!.staves;
    const head = playheadPosition(layout, 0, 0.25)!;

    expect(head.x).toBeCloseTo(guitar!.measures[0]!.beats[2]!.x);
    expect(head.x).toBeCloseTo(bass!.measures[0]!.beats[1]!.x);
  });

  it('spans every staff of its system', () => {
    const layout = layoutSong(demoSong(), { width: 2400 });
    const system = layout.systems[0]!;
    const head = playheadPosition(layout, 0, 0)!;
    expect(head.y).toBeLessThanOrEqual(system.y);
    expect(head.y + head.height).toBeGreaterThanOrEqual(system.y + system.height);
  });

  it('crosses into an empty tail of a partly filled bar', () => {
    // One quarter written in a 4/4 bar: three quarters of the bar is empty and
    // the playhead still has to travel across it.
    const song = produce(guitarOnly(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, F.QUARTER);
    });
    const layout = layoutSong(song, { width: 2400 });
    const measure = layout.systems[0]!.staves[0]!.measures[0]!;

    const head = playheadPosition(layout, 0, 0.75)!;
    expect(head.x).toBeGreaterThan(measure.beats[0]!.left);
    expect(head.x).toBeLessThanOrEqual(measure.x + measure.width);
  });

  it('has no position for a bar outside the score', () => {
    const layout = layoutSong(guitarOnly(2), { width: 2400 });
    expect(playheadPosition(layout, 9, 0)).toBeUndefined();
  });
});

describe('alignment across tracks', () => {
  it('draws simultaneous notes at the same x', () => {
    // A bass quarter starting on beat 2 sounds at the same instant as the
    // guitar's third eighth, so a reader must see them in one column.
    const layout = layoutSong(mixedRhythms(), { width: 2400 });
    const [guitar, bass] = layout.systems[0]!.staves;
    const gx = guitar!.measures[0]!.beats.map((b) => b.x);
    const bx = bass!.measures[0]!.beats.map((b) => b.x);

    expect(bx[0]).toBeCloseTo(gx[0]!);
    expect(bx[1]).toBeCloseTo(gx[2]!);
    expect(bx[2]).toBeCloseTo(gx[4]!);
    expect(bx[3]).toBeCloseTo(gx[6]!);
  });

  it('gives a longer note a wider column than the notes it spans', () => {
    // The bass quarter must cover both guitar eighths, so clicking anywhere
    // under it selects it rather than falling through to empty space.
    const layout = layoutSong(mixedRhythms(), { width: 2400 });
    const [guitar, bass] = layout.systems[0]!.staves;
    const quarter = bass!.measures[0]!.beats[0]!;
    const eighth = guitar!.measures[0]!.beats[0]!;
    expect(quarter.width).toBeCloseTo(eighth.width * 2);
  });

  it('shares one column grid across every staff', () => {
    const layout = layoutSong(mixedRhythms(), { width: 2400 });
    const [guitar, bass] = layout.systems[0]!.staves;
    expect(bass!.measures[0]!.columns).toEqual(guitar!.measures[0]!.columns);
  });
});

describe('scrub ruler', () => {
  it('sits above the top staff, clear of its click region', () => {
    const layout = layoutSong(mixedRhythms());
    const system = layout.systems[0]!;
    const band = rulerBand(system.y, layout.options);
    // Entirely above the staff so a ruler click is never an edit and vice versa.
    expect(band.bottom).toBeLessThan(system.staves[0]!.y - layout.options.lineSpacing / 2);
    expect(band.top).toBeLessThan(band.line);
  });

  it('maps a ruler click back to the offset the playhead draws it at', () => {
    const layout = layoutSong(mixedRhythms());
    const system = layout.systems[0]!;
    const measure = system.staves[0]!.measures[0]!;
    const y = rulerBand(system.y, layout.options).line;

    // Forward: where the playhead would sit for beat 2 (offset 1/4). Inverse:
    // clicking there gets that offset back, so click and line agree.
    for (const offset of [0, 0.25, 0.5, 0.75]) {
      const x = offsetToX(measure, offset);
      const target = positionAtX(layout, x, y)!;
      expect(target.bar).toBe(0);
      expect(target.offset).toBeCloseTo(offset, 5);
    }
  });

  it('is not scrubbable off the ruler, on the staff', () => {
    const layout = layoutSong(mixedRhythms());
    const system = layout.systems[0]!;
    const staff = system.staves[0]!;
    const x = staff.measures[0]!.beats[0]!.x;
    // A click on a note is an edit, not a scrub.
    expect(positionAtX(layout, x, staff.y)).toBeUndefined();
  });

  it('clamps a click past the last bar to the end of the system', () => {
    const layout = layoutSong(guitarOnly(2));
    const system = layout.systems[0]!;
    const y = rulerBand(system.y, layout.options).line;
    const target = positionAtX(layout, system.contentRight + 200, y)!;
    expect(target.bar).toBe(1); // the last bar, not undefined
  });
});

describe('annotations layout', () => {
  it('positions a note above its anchor bar on the onset grid', () => {
    const song = produce(guitarOnly(4), (d) => {
      E.addAnnotation(d, { id: 'a', bar: 2, offset: F.ZERO, text: 'x2' });
    });
    const layout = layoutSong(song, { width: 2400 });
    expect(layout.annotations).toHaveLength(1);
    const laid = layout.annotations[0]!;
    const system = layout.systems.find((s) => 2 >= s.firstMeasure && 2 < s.lastMeasure)!;
    const measure = system.staves[0]!.measures.find((m) => m.measureIndex === 2)!;
    expect(laid.x).toBeCloseTo(offsetToX(measure, 0));
    expect(laid.y).toBeLessThan(system.y); // above the staff
  });

  it('drops a note anchored past the last bar rather than floating it', () => {
    const song = produce(guitarOnly(2), (d) => {
      E.addAnnotation(d, { id: 'a', bar: 9, offset: F.ZERO, text: 'x' });
    });
    expect(layoutSong(song).annotations).toHaveLength(0);
  });
});

describe('empty-bar ruler spacing', () => {
  it('spreads an empty bar evenly instead of cramming the grid to the right', () => {
    const measure = layoutSong(guitarOnly(1)).systems[0]!.staves[0]!.measures[0]!;
    const xs = [0, 0.25, 0.5, 0.75, 1].map((o) => offsetToX(measure, o));
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    // Every quarter-gap is equal — the ticks are not bunched into the right half.
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 1);
    // The downbeat sits at the far left, not the middle of the bar.
    expect(xs[0]!).toBeLessThan((xs[0]! + xs[4]!) / 2);
  });
});
