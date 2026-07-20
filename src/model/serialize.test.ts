import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import * as E from './edit';
import * as F from './fraction';
import { MigrationError, migrate } from './migrate';
import { SongParseError, songFromJson, songToJson, suggestedFilename } from './serialize';
import { createDrumTrack, createSong, createStringTrack } from './song';
import { CURRENT_SCHEMA_VERSION, type Song } from './types';

function populatedSong(): Song {
  const song = createSong({
    title: 'Test Riff',
    artist: 'Nobody',
    tracks: [createStringTrack('guitar', { measureCount: 2 }), createDrumTrack({ measureCount: 2 })],
  });
  return produce(song, (d) => {
    const guitar = d.tracks[0]!.id;
    const drums = d.tracks[1]!.id;
    E.setNote(d, guitar, 0, 0, 0, 3, F.QUARTER);
    E.setNote(d, guitar, 0, 1, 1, 5, F.tuplet(F.EIGHTH, 3, 2)); // a triplet
    E.toggleTechnique(d, guitar, 0, 0, 0, 'palmMute');
    E.toggleDrumNote(d, drums, 0, 0, 'kick', F.QUARTER);
    E.toggleDrumNote(d, drums, 0, 0, 'hihat', F.QUARTER, 'accent');
    E.setTempo(d, 96, 1);
    E.setKey(d, { tonic: 'E', mode: 'minor' });
  });
}

describe('round trip', () => {
  it('survives export and re-import unchanged', () => {
    const song = populatedSong();
    expect(songFromJson(songToJson(song))).toEqual(song);
  });

  it('preserves exact fractions through JSON', () => {
    const song = populatedSong();
    const reloaded = songFromJson(songToJson(song));
    const beat = reloaded.tracks[0]!.measures[0]!.beats[1]!;
    // A triplet eighth is 1/12 — it must come back exactly, not as 0.0833…
    expect(beat.duration).toEqual(F.tuplet(F.EIGHTH, 3, 2));
    expect(F.toString(beat.duration)).toBe('1/12');
  });

  it('preserves techniques, articulations and key', () => {
    const reloaded = songFromJson(songToJson(populatedSong()));
    expect(reloaded.tracks[0]!.measures[0]!.beats[0]!.notes[0]).toMatchObject({
      techniques: ['palmMute'],
    });
    expect(reloaded.tracks[1]!.measures[0]!.beats[0]!.notes).toContainEqual(
      expect.objectContaining({ piece: 'hihat', articulation: 'accent' }),
    );
    expect(reloaded.key).toEqual({ tonic: 'E', mode: 'minor' });
  });

  it('writes a stable, diffable file', () => {
    const song = populatedSong();
    expect(songToJson(song)).toBe(songToJson(song));
    expect(songToJson(song)).toContain('\n'); // pretty-printed by default
    expect(songToJson(song, false)).not.toContain('\n');
  });
});

describe('validation', () => {
  const valid = () => JSON.parse(songToJson(populatedSong())) as Record<string, unknown>;

  it('rejects malformed JSON with a useful message', () => {
    expect(() => songFromJson('{ not json')).toThrow(SongParseError);
    expect(() => songFromJson('{ not json')).toThrow(/not valid JSON/i);
  });

  it('rejects a non-object document', () => {
    // Caught by the migration step before validation, so the error type differs
    // from a structural failure. Both are "this file cannot be opened" to the
    // caller, so the import UI must treat them the same.
    expect(() => songFromJson('42')).toThrow(/not an object/);
    expect(() => songFromJson('null')).toThrow();
    expect(() => songFromJson('[]')).toThrow();
  });

  it('reports the path to the offending field', () => {
    const broken = valid();
    (broken.tracks as Record<string, unknown>[])[0]!.tuning = [1, 2, 3];
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/tracks\[0\]\.tuning\[0\]/);
  });

  it('rejects a song with no tracks, tempo or time signature', () => {
    for (const field of ['tracks', 'tempoMap', 'timeSignatures']) {
      const broken = valid();
      broken[field] = [];
      expect(() => songFromJson(JSON.stringify(broken))).toThrow(SongParseError);
    }
  });

  it('rejects a fraction with a zero or negative denominator', () => {
    const broken = valid();
    const beat = (broken.tracks as any)[0].measures[0].beats[0];
    beat.duration = { n: 1, d: 0 };
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/denominator/);
  });

  it('rejects a non-integer fraction, which would desynchronise playback', () => {
    const broken = valid();
    const beat = (broken.tracks as any)[0].measures[0].beats[0];
    beat.duration = { n: 0.5, d: 4 };
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/integers/);
  });

  it('rejects an unknown track kind', () => {
    const broken = valid();
    (broken.tracks as any)[0].kind = 'theremin';
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/unknown track kind/);
  });

  it('rejects a note that is neither fretted nor percussive', () => {
    const broken = valid();
    (broken.tracks as any)[0].measures[0].beats[0].notes[0] = { id: 'nt_x' };
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/neither string\/fret nor piece/);
  });

  it('rejects a non-positive tempo', () => {
    const broken = valid();
    (broken.tempoMap as any)[0].bpm = 0;
    expect(() => songFromJson(JSON.stringify(broken))).toThrow(/positive/);
  });
});

describe('migration', () => {
  it('passes a current-version document through untouched', () => {
    const song = populatedSong();
    expect(migrate(JSON.parse(JSON.stringify(song)))).toEqual(song);
  });

  it('refuses a document from a newer app version rather than dropping fields', () => {
    const future = { ...JSON.parse(songToJson(populatedSong())), schemaVersion: 999 };
    expect(() => migrate(future)).toThrow(MigrationError);
    expect(() => migrate(future)).toThrow(/newer version/i);
  });

  it('refuses a version with no registered migration path', () => {
    const ancient = { ...JSON.parse(songToJson(populatedSong())), schemaVersion: 0 };
    // Version 0 predates the schema; with no migration registered this must
    // fail loudly rather than be silently treated as current.
    expect(() => migrate(ancient)).toThrow(MigrationError);
  });

  it('stamps new songs with the current version', () => {
    expect(createSong().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe('suggestedFilename', () => {
  it('derives a safe filename from the title', () => {
    expect(suggestedFilename(createSong({ title: 'My Song' }))).toBe('My-Song.qtm');
    expect(suggestedFilename(createSong({ title: 'A/B: "test"?' }))).toBe('AB-test.qtm');
  });

  it('falls back when the title has no usable characters', () => {
    expect(suggestedFilename(createSong({ title: '///' }))).toBe('untitled-song.qtm');
    expect(suggestedFilename(createSong({ title: '   ' }))).toBe('untitled-song.qtm');
  });
});
