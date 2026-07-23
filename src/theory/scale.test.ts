import { describe, expect, it } from 'vitest';
import type { SongKey } from '../model/types';
import {
  diatonicChords,
  scaleInfo,
  scaleRole,
  suggestedProgressions,
} from './scale';

const key = (tonic: string, mode: SongKey['mode']): SongKey => ({ tonic, mode });

describe('scaleInfo', () => {
  it('spells C major with natural notes', () => {
    const info = scaleInfo(key('C', 'major'));
    expect(info.notes).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(info.pitchClasses).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(info.degrees).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  it('keeps flats flat in a flat key', () => {
    const info = scaleInfo(key('Bb', 'major'));
    expect(info.notes).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
  });

  it('labels the lowered degrees of natural minor', () => {
    const info = scaleInfo(key('A', 'minor'));
    expect(info.notes).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(info.degrees).toEqual(['1', '2', 'b3', '4', '5', 'b6', 'b7']);
  });

  it('handles a five-note pentatonic scale', () => {
    const info = scaleInfo(key('E', 'minorPentatonic'));
    expect(info.notes).toEqual(['E', 'G', 'A', 'B', 'D']);
    expect(info.pitchClasses).toHaveLength(5);
  });
});

describe('diatonicChords', () => {
  it('produces the classic major-key qualities', () => {
    const chords = diatonicChords(key('C', 'major'));
    expect(chords.map((c) => c.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(chords.map((c) => c.symbol)).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'Bdim',
    ]);
  });

  it('produces the natural-minor qualities', () => {
    const chords = diatonicChords(key('A', 'minor'));
    expect(chords.map((c) => c.roman)).toEqual(['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
  });

  it('roots the fifth chord of C major on G with G-B-D', () => {
    const five = diatonicChords(key('C', 'major'))[4]!;
    expect(five.root).toBe('G');
    expect(five.pitchClasses).toEqual([7, 11, 2]);
  });

  it('returns nothing for a pentatonic key', () => {
    expect(diatonicChords(key('E', 'minorPentatonic'))).toEqual([]);
  });
});

describe('suggestedProgressions', () => {
  it('resolves I–V–vi–IV to real chords in C major', () => {
    const [first] = suggestedProgressions(key('C', 'major'));
    expect(first?.label).toBe('I – V – vi – IV');
    expect(first?.chords.map((c) => c.symbol)).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('offers minor-family progressions in a minor key', () => {
    const progs = suggestedProgressions(key('A', 'minor'));
    expect(progs.length).toBeGreaterThan(0);
    expect(progs[0]?.chords[0]?.symbol).toBe('Am');
  });

  it('has none for a scale without diatonic chords', () => {
    expect(suggestedProgressions(key('E', 'blues'))).toEqual([]);
  });
});

describe('scaleRole', () => {
  const info = scaleInfo(key('C', 'major'));
  it('marks the tonic as the root', () => {
    expect(scaleRole(0, info)).toBe('root');
  });
  it('marks other scale tones as scale', () => {
    expect(scaleRole(7, info)).toBe('scale');
  });
  it('marks out-of-key tones as none', () => {
    expect(scaleRole(1, info)).toBe('none');
  });
});
