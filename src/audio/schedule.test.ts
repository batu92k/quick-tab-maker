/**
 * Playback timing, checked against hand-worked numbers.
 *
 * Timing is the part of playback that cannot be verified by ear: a note ten
 * milliseconds early sounds fine in isolation and ruins a song at bar 200. So
 * every number here was worked out on paper first — 120 BPM means a quarter is
 * exactly 0.5s, and a 4/4 bar is exactly 2s — and the code is checked against
 * that rather than against its own previous output.
 */

import { describe, expect, it } from 'vitest';
import * as F from '../model/fraction';
import { createBeat, createDrumTrack, createSong, createStringTrack } from '../model/song';
import { newNoteId } from '../model/ids';
import type { DrumNote, DrumPiece, Measure, Note, Song, StringTrack, Technique, Track } from '../model/types';
import { DRUM_PIECE_TO_GM, pitchToMidi } from '../theory/midi';
import {
  barTimes,
  buildPlan,
  effectiveMixer,
  isAudible,
  metronomeClicks,
  positionAtTime,
  scheduleSong,
  songDuration,
} from './schedule';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function note(string: number, fret: number, techniques: Technique[] = []): Note {
  return { id: newNoteId(), string, fret, techniques };
}

function drum(piece: DrumPiece, articulation: DrumNote['articulation'] = 'normal'): DrumNote {
  return { id: newNoteId(), piece, articulation };
}

/** A guitar track whose bars are filled with the given beats. */
function guitarWith(bars: readonly (readonly { d: F.Fraction; notes: Note[] }[])[]): StringTrack {
  const track = createStringTrack('guitar', { measureCount: bars.length });
  const measures: Measure<Note>[] = bars.map((beats, i) => {
    let start = F.ZERO;
    const laid = beats.map((b) => {
      const beat = createBeat<Note>(start, b.d, b.notes);
      start = F.add(start, b.d);
      return beat;
    });
    return { ...track.measures[i]!, beats: laid };
  });
  return { ...track, measures };
}

function songOf(tracks: readonly Track[], tempo = 120): Song {
  return createSong({ tracks, tempo });
}

/* -------------------------------------------------------------------------- */

describe('bar times', () => {
  it('places bars two seconds apart in 4/4 at 120', () => {
    const song = songOf([createStringTrack('guitar', { measureCount: 4 })]);
    expect(barTimes(song)).toEqual([0, 2, 4, 6, 8]);
    expect(songDuration(song)).toBe(8);
  });

  it('treats BPM as quarter notes even in compound time', () => {
    // 6/8 is six eighths = three quarters. At 120 that is 1.5s, not 3s.
    const song = createSong({
      tracks: [createStringTrack('guitar', { measureCount: 2 })],
      tempo: 120,
      timeSig: { num: 6, den: 8 },
    });
    expect(barTimes(song)).toEqual([0, 1.5, 3]);
  });

  it('honours a tempo change part way through', () => {
    const base = songOf([createStringTrack('guitar', { measureCount: 4 })]);
    // Bars 0-1 at 120 (2s each), bars 2-3 at 60 (4s each).
    const song: Song = { ...base, tempoMap: [...base.tempoMap, { bar: 2, bpm: 60 }] };
    expect(barTimes(song)).toEqual([0, 2, 4, 8, 12]);
  });
});

describe('positionAtTime', () => {
  const song = songOf([createStringTrack('guitar', { measureCount: 4 })]);

  it('maps a moment to a bar and an offset in whole notes', () => {
    // 2.5s is half a second into bar 1 — one quarter note, i.e. 1/4.
    expect(positionAtTime(song, 2.5)).toEqual({ bar: 1, offset: 0.25 });
  });

  it('puts a bar boundary at the start of the later bar, not the end of the earlier', () => {
    expect(positionAtTime(song, 2)).toEqual({ bar: 1, offset: 0 });
  });

  it('has no position before the song or after it', () => {
    expect(positionAtTime(song, -0.5)).toBeUndefined();
    expect(positionAtTime(song, 8)).toBeUndefined();
  });

  it('follows a tempo change', () => {
    const slower: Song = { ...song, tempoMap: [...song.tempoMap, { bar: 2, bpm: 60 }] };
    // Bar 2 starts at 4s and runs at 60 BPM, so one second in is one quarter.
    expect(positionAtTime(slower, 5)).toEqual({ bar: 2, offset: 0.25 });
  });
});

describe('scheduleSong', () => {
  it('places notes at their bar offset in seconds', () => {
    const track = guitarWith([
      [
        { d: F.QUARTER, notes: [note(0, 0)] },
        { d: F.QUARTER, notes: [note(0, 3)] },
      ],
      [{ d: F.HALF, notes: [note(1, 5)] }],
    ]);
    const events = scheduleSong(songOf([track]));

    expect(events.map((e) => e.time)).toEqual([0, 0.5, 2]);
    expect(events.map((e) => e.duration)).toEqual([0.5, 0.5, 1]);
  });

  it('resolves pitch through the tuning', () => {
    const track = guitarWith([[{ d: F.QUARTER, notes: [note(0, 5)] }]]);
    const [event] = scheduleSong(songOf([track]));
    // Fifth fret of the low E string is A2.
    expect(event?.midi).toBe(pitchToMidi('A2'));
  });

  it('sounds every note of a chord at the same instant', () => {
    const track = guitarWith([[{ d: F.QUARTER, notes: [note(0, 0), note(1, 2), note(2, 2)] }]]);
    const events = scheduleSong(songOf([track]));
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.time))).toEqual(new Set([0]));
  });

  it('holds a tied note instead of striking it twice', () => {
    const track = guitarWith([
      [
        { d: F.QUARTER, notes: [note(0, 5)] },
        { d: F.QUARTER, notes: [note(0, 5, ['tie'])] },
      ],
    ]);
    const events = scheduleSong(songOf([track]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ time: 0, duration: 1 });
  });

  it('re-strikes when a tie names a different pitch, which cannot be tied', () => {
    const track = guitarWith([
      [
        { d: F.QUARTER, notes: [note(0, 5)] },
        { d: F.QUARTER, notes: [note(0, 7, ['tie'])] },
      ],
    ]);
    expect(scheduleSong(songOf([track]))).toHaveLength(2);
  });

  it('shortens and softens a palm-muted note', () => {
    const open = guitarWith([[{ d: F.QUARTER, notes: [note(0, 5)] }]]);
    const muted = guitarWith([[{ d: F.QUARTER, notes: [note(0, 5, ['palmMute'])] }]]);
    const [plain] = scheduleSong(songOf([open]));
    const [damped] = scheduleSong(songOf([muted]));

    expect(damped!.duration).toBeLessThan(plain!.duration);
    expect(damped!.velocity).toBeLessThan(plain!.velocity);
  });

  it('maps drum pieces to General MIDI', () => {
    const track = createDrumTrack({ measureCount: 1 });
    const withHit: Track = {
      ...track,
      measures: [{ ...track.measures[0]!, beats: [createBeat<DrumNote>(F.ZERO, F.QUARTER, [drum('snare')])] }],
    };
    const [event] = scheduleSong(songOf([withHit]));
    expect(event?.midi).toBe(DRUM_PIECE_TO_GM.snare);
    expect(event?.kind).toBe('percussive');
  });

  it('hits an accent harder than a ghost note', () => {
    const track = createDrumTrack({ measureCount: 1 });
    const withHits: Track = {
      ...track,
      measures: [
        {
          ...track.measures[0]!,
          beats: [
            createBeat<DrumNote>(F.ZERO, F.QUARTER, [drum('snare', 'accent')]),
            createBeat<DrumNote>(F.QUARTER, F.QUARTER, [drum('snare', 'ghost')]),
          ],
        },
      ],
    };
    const [accent, ghost] = scheduleSong(songOf([withHits]));
    expect(accent!.velocity).toBeGreaterThan(ghost!.velocity);
  });

  it('is sorted by time', () => {
    const guitar = guitarWith([[{ d: F.HALF, notes: [note(0, 1)] }]]);
    const drums = createDrumTrack({ measureCount: 1 });
    const withHit: Track = {
      ...drums,
      measures: [{ ...drums.measures[0]!, beats: [createBeat<DrumNote>(F.ZERO, F.QUARTER, [drum('kick')])] }],
    };
    const events = scheduleSong(songOf([guitar, withHit]));
    const times = events.map((e) => e.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('still schedules a muted track, which mute turns down rather than removes', () => {
    // Dropping it here would mean unmuting mid-playback did nothing until the
    // next press of play.
    const track = guitarWith([[{ d: F.QUARTER, notes: [note(0, 5)] }]]);
    const muted: Track = { ...track, mixer: { ...track.mixer, muted: true } };
    expect(scheduleSong(songOf([muted]))).toHaveLength(1);
  });
});

describe('mute and solo', () => {
  const a = createStringTrack('guitar', { measureCount: 1 });
  const b = createStringTrack('bass', { measureCount: 1 });

  it('hears everything when nothing is muted or soloed', () => {
    expect([a, b].every((t) => isAudible([a, b], t))).toBe(true);
  });

  it('silences everything but the soloed track', () => {
    const soloed: Track = { ...a, mixer: { ...a.mixer, solo: true } };
    expect(isAudible([soloed, b], soloed)).toBe(true);
    expect(isAudible([soloed, b], b)).toBe(false);
  });

  it('keeps a muted track silent even when it is also soloed', () => {
    const both: Track = { ...a, mixer: { ...a.mixer, solo: true, muted: true } };
    expect(isAudible([both, b], both)).toBe(false);
    // …and its solo must not silence the rest of the mix on its way out.
    expect(isAudible([both, b], b)).toBe(true);
  });

  it('folds solo into the mute the engine is handed', () => {
    const soloed: Track = { ...a, mixer: { ...a.mixer, solo: true } };
    expect(effectiveMixer([soloed, b], b).muted).toBe(true);
  });
});

describe('metronome', () => {
  it('clicks once per denominator unit, accenting the downbeat', () => {
    const song = songOf([createStringTrack('guitar', { measureCount: 1 })]);
    expect(metronomeClicks(song, 0, 1)).toEqual([
      { time: 0, accent: true },
      { time: 0.5, accent: false },
      { time: 1, accent: false },
      { time: 1.5, accent: false },
    ]);
  });

  it('follows the time signature', () => {
    const song = createSong({
      tracks: [createStringTrack('guitar', { measureCount: 1 })],
      tempo: 120,
      timeSig: { num: 3, den: 4 },
    });
    expect(metronomeClicks(song, 0, 1).map((c) => c.time)).toEqual([0, 0.5, 1]);
  });
});

describe('buildPlan', () => {
  const track = guitarWith([[{ d: F.QUARTER, notes: [note(0, 5)] }]]);

  it('leaves times alone with no count-in', () => {
    const plan = buildPlan(songOf([track]));
    expect(plan.songOffset).toBe(0);
    expect(plan.events[0]?.time).toBe(0);
    expect(plan.countIn).toEqual([]);
  });

  it('always schedules the metronome, which is switched by gain not by absence', () => {
    // Turning the click on mid-take is the normal case, and it cannot work if
    // the clicks were never scheduled.
    expect(buildPlan(songOf([track])).clicks).toHaveLength(4);
  });

  it('pushes the song back by the count-in and says by how much', () => {
    const plan = buildPlan(songOf([track]), { countInBars: 1 });
    expect(plan.songOffset).toBe(2);
    expect(plan.events[0]?.time).toBe(2);
    // Four count-in clicks, all before the song starts.
    expect(plan.countIn).toHaveLength(4);
    expect(plan.countIn.every((c) => c.time < 2)).toBe(true);
  });

  it('counts in at the opening tempo, not some later one', () => {
    const base = songOf([guitarWith([[], [], []])]);
    const song: Song = { ...base, tempoMap: [{ bar: 0, bpm: 60 }, { bar: 1, bpm: 120 }] };
    // Bar 0 at 60 BPM is a four-second bar, so one count-in bar is four seconds.
    expect(buildPlan(song, { countInBars: 1 }).songOffset).toBe(4);
  });

  it('shifts the metronome past the count-in but not the count-in itself', () => {
    const plan = buildPlan(songOf([track]), { countInBars: 1 });
    expect(plan.countIn.every((c) => c.time < 2)).toBe(true);
    expect(plan.clicks.every((c) => c.time >= 2)).toBe(true);
  });

  it('converts a loop region to transport seconds past the count-in', () => {
    const song = songOf([createStringTrack('guitar', { measureCount: 4 })]);
    const plan = buildPlan(song, { countInBars: 1, loop: { startBar: 1, endBar: 3 } });
    expect(plan.loop).toEqual({ start: 2 + 2, end: 2 + 6 });
  });

  it('drops an empty or inverted loop rather than trapping the transport', () => {
    const song = songOf([createStringTrack('guitar', { measureCount: 4 })]);
    expect(buildPlan(song, { loop: { startBar: 2, endBar: 2 } }).loop).toBeNull();
    expect(buildPlan(song, { loop: { startBar: 3, endBar: 1 } }).loop).toBeNull();
  });
});
