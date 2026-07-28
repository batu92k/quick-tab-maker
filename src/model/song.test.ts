import { describe, expect, it } from 'vitest';
import * as F from './fraction';
import {
  createBeat,
  createSong,
  createStringTrack,
  gridStops,
  measureCapacity,
  nextGridStop,
  resolveOffsetToCursorParts,
} from './song';
import type { Measure, Note } from './types';

const Q = F.QUARTER;

function guitarMeasure(): { song: ReturnType<typeof createSong>; measure: Measure<Note> } {
  const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 1 })] });
  const track = song.tracks[0]!;
  return { song, measure: track.measures[0]! as Measure<Note> };
}

describe('gridStops', () => {
  it('lists the quarter grid of an empty 4/4 bar, excluding the bar end', () => {
    const { song, measure } = guitarMeasure();
    const capacity = measureCapacity(song, song.tracks[0]!, 0);
    const stops = gridStops(measure, capacity, Q);
    expect(stops.map((s) => F.toString(s))).toEqual(['0', '1/4', '1/2', '3/4']);
  });

  it('includes an off-grid onset alongside the snap grid, sorted', () => {
    const { song, measure: base } = guitarMeasure();
    const capacity = measureCapacity(song, song.tracks[0]!, 0);
    const measure: Measure<Note> = {
      ...base,
      beats: [createBeat(F.EIGHTH, F.EIGHTH, [])],
    };
    const stops = gridStops(measure, capacity, Q);
    expect(stops.map((s) => F.toString(s))).toEqual(['0', '1/8', '1/4', '1/2', '3/4']);
  });

  it('dedupes when a beat start coincides with a grid point', () => {
    const { song, measure: base } = guitarMeasure();
    const capacity = measureCapacity(song, song.tracks[0]!, 0);
    const measure: Measure<Note> = {
      ...base,
      beats: [createBeat(Q, Q, [])],
    };
    const stops = gridStops(measure, capacity, Q);
    expect(stops.map((s) => F.toString(s))).toEqual(['0', '1/4', '1/2', '3/4']);
  });
});

describe('nextGridStop', () => {
  const stops = [F.ZERO, F.frac(1, 4), F.frac(1, 2), F.frac(3, 4)];

  it('returns the neighbor going forward', () => {
    expect(nextGridStop(stops, F.ZERO, 1)).toEqual(F.frac(1, 4));
    expect(nextGridStop(stops, F.frac(1, 4), 1)).toEqual(F.frac(1, 2));
  });

  it('returns the neighbor going backward', () => {
    expect(nextGridStop(stops, F.frac(3, 4), -1)).toEqual(F.frac(1, 2));
    expect(nextGridStop(stops, F.frac(1, 4), -1)).toEqual(F.ZERO);
  });

  it('returns null past the last stop going forward', () => {
    expect(nextGridStop(stops, F.frac(3, 4), 1)).toBeNull();
  });

  it('returns null before the first stop going backward', () => {
    expect(nextGridStop(stops, F.ZERO, -1)).toBeNull();
  });
});

describe('resolveOffsetToCursorParts', () => {
  it('returns the beatIndex directly when the offset is an existing onset', () => {
    const { measure: base } = guitarMeasure();
    const measure: Measure<Note> = {
      ...base,
      beats: [createBeat(F.ZERO, Q, []), createBeat(Q, Q, [])],
    };
    expect(resolveOffsetToCursorParts(measure, Q)).toEqual({ beatIndex: 1 });
  });

  it('returns an insertAt for an empty grid slot', () => {
    const { measure: base } = guitarMeasure();
    const measure: Measure<Note> = {
      ...base,
      beats: [createBeat(F.ZERO, Q, [])],
    };
    expect(resolveOffsetToCursorParts(measure, F.frac(1, 2))).toEqual({
      beatIndex: 1,
      insertAt: F.frac(1, 2),
    });
  });

  it('returns an insertAt when the bar is entirely empty', () => {
    const { measure } = guitarMeasure();
    expect(resolveOffsetToCursorParts(measure, F.ZERO)).toEqual({
      beatIndex: 0,
      insertAt: F.ZERO,
    });
  });
});
