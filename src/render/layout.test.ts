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
  hitTest,
  layoutSong,
  lineForNote,
  naturalMeasureWidth,
} from './layout';

const guitarOnly = (measureCount = 4): Song =>
  createSong({ tracks: [createStringTrack('guitar', { measureCount })] });

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
    const width = naturalMeasureWidth(song.tracks[0]!, 0, DEFAULT_LAYOUT_OPTIONS);
    expect(width).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.minMeasureWidth);
  });

  it('gives a denser bar more room than a sparse one', () => {
    const song = produce(guitarOnly(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 1, F.QUARTER); // one quarter
      for (let i = 0; i < 8; i++) E.setNote(d, id, 1, i, 0, i, F.EIGHTH); // eight eighths
    });
    const track = song.tracks[0]!;
    const sparse = naturalMeasureWidth(track, 0, DEFAULT_LAYOUT_OPTIONS);
    const dense = naturalMeasureWidth(track, 1, DEFAULT_LAYOUT_OPTIONS);
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
