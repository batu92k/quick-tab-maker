/**
 * Key-aware scale and chord theory.
 *
 * Wraps tonal for note spelling (so a flat key reads Bb, not A#) but computes
 * chord qualities from pitch-class intervals directly rather than round-tripping
 * through `Chord.detect`, whose spelling of a stacked triad is occasionally
 * surprising. The renderer, the theory panel and the fretboard overlay all read
 * from here, so pitches are decided in exactly one place — the same discipline
 * `theory/midi.ts` holds for sounding notes.
 */

import { Note, Scale } from 'tonal';
import type { Mode, SongKey } from '../model/types';

/** How tonal names each mode we expose. */
const SCALE_NAME: Readonly<Record<Mode, string>> = {
  major: 'major',
  minor: 'minor',
  ionian: 'ionian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'aeolian',
  locrian: 'locrian',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  blues: 'minor blues',
};

/** Human label for the mode, for headings. */
const MODE_LABEL: Readonly<Record<Mode, string>> = {
  major: 'major',
  minor: 'minor',
  ionian: 'ionian',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'aeolian',
  locrian: 'locrian',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  blues: 'blues',
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';

export interface ScaleInfo {
  /** Tonic spelled as the key gives it, e.g. 'Bb'. */
  readonly tonic: string;
  /** e.g. 'C major', 'E minor pentatonic'. */
  readonly name: string;
  /** Scale note names in order, e.g. ['C','D','E','F','G','A','B']. */
  readonly notes: readonly string[];
  /** Pitch classes 0–11 of the scale notes, in the same order. */
  readonly pitchClasses: readonly number[];
  /** Scale-degree labels, e.g. ['1','2','3','4','5','6','7'] or with flats. */
  readonly degrees: readonly string[];
}

export interface DiatonicChord {
  /** 1-based degree of the scale the chord is rooted on. */
  readonly degree: number;
  /** Roman numeral, cased and marked by quality: 'ii', 'V', 'vii°', 'III+'. */
  readonly roman: string;
  /** Chord symbol, e.g. 'Dm', 'G', 'Bdim'. */
  readonly symbol: string;
  /** Root note name. */
  readonly root: string;
  readonly quality: TriadQuality;
  /** Pitch classes 0–11 of the triad tones. */
  readonly pitchClasses: readonly number[];
}

/** Where a pitch class sits relative to the key, for overlays. */
export type ScaleRole = 'root' | 'scale' | 'none';

const chroma = (name: string): number => {
  const c = Note.chroma(name);
  return c === undefined ? -1 : c;
};

/** Resolves the scale for a key, or a bare tonic triad's worth if tonal balks. */
export function scaleInfo(key: SongKey): ScaleInfo {
  const name = `${key.tonic} ${SCALE_NAME[key.mode]}`;
  const scale = Scale.get(name);
  const notes = scale.notes.length > 0 ? scale.notes : [key.tonic];
  const intervals = scale.intervals.length > 0 ? scale.intervals : ['1P'];
  return {
    tonic: notes[0] ?? key.tonic,
    name: `${key.tonic} ${MODE_LABEL[key.mode]}`,
    notes,
    pitchClasses: notes.map(chroma).filter((c) => c >= 0),
    // tonal writes intervals like '1P','3m'; the leading number is the degree.
    degrees: intervals.map((iv) => degreeLabel(iv)),
  };
}

/** '1P' -> '1', '3m' -> 'b3', '5A' -> '#5' — a compact scale-degree name. */
function degreeLabel(interval: string): string {
  const num = interval.match(/\d+/)?.[0] ?? '1';
  const quality = interval.replace(/[\d-]/g, '');
  const accidental =
    quality === 'm' || quality === 'd' ? 'b' : quality === 'A' ? '#' : '';
  return `${accidental}${num}`;
}

const QUALITY_SUFFIX: Readonly<Record<TriadQuality, string>> = {
  major: '',
  minor: 'm',
  diminished: 'dim',
  augmented: 'aug',
};

const QUALITY_ROMAN_MARK: Readonly<Record<TriadQuality, string>> = {
  major: '',
  minor: '',
  diminished: '°',
  augmented: '+',
};

/** Triad quality from the intervals above the root, in semitones. */
function triadQuality(third: number, fifth: number): TriadQuality | null {
  if (third === 4 && fifth === 7) return 'major';
  if (third === 3 && fifth === 7) return 'minor';
  if (third === 3 && fifth === 6) return 'diminished';
  if (third === 4 && fifth === 8) return 'augmented';
  return null;
}

/**
 * Diatonic triads built by stacking thirds within the scale. Only meaningful for
 * seven-note scales; pentatonic and blues scales return no chords, since a
 * degree-based triad off a five-note scale is not a chord anyone would name.
 */
export function diatonicChords(key: SongKey): DiatonicChord[] {
  const { notes, pitchClasses } = scaleInfo(key);
  if (notes.length !== 7) return [];

  const chords: DiatonicChord[] = [];
  for (let i = 0; i < 7; i++) {
    const root = notes[i]!;
    const rootPc = pitchClasses[i]!;
    const thirdPc = pitchClasses[(i + 2) % 7]!;
    const fifthPc = pitchClasses[(i + 4) % 7]!;
    const third = (thirdPc - rootPc + 12) % 12;
    const fifth = (fifthPc - rootPc + 12) % 12;
    const quality = triadQuality(third, fifth);
    if (!quality) continue;

    const numeral = ROMAN[i]!;
    const roman =
      (quality === 'minor' || quality === 'diminished'
        ? numeral.toLowerCase()
        : numeral) + QUALITY_ROMAN_MARK[quality];
    chords.push({
      degree: i + 1,
      roman,
      symbol: root + QUALITY_SUFFIX[quality],
      root,
      quality,
      pitchClasses: [rootPc, thirdPc, fifthPc],
    });
  }
  return chords;
}

/** Curated progressions by mode family, as arrays of 1-based scale degrees. */
const PROGRESSIONS: Readonly<Record<'major' | 'minor', readonly (readonly number[])[]>> = {
  major: [
    [1, 5, 6, 4],
    [2, 5, 1],
    [1, 4, 5],
    [1, 6, 4, 5],
  ],
  minor: [
    [1, 6, 3, 7],
    [1, 4, 5],
    [2, 5, 1],
    [1, 7, 6, 7],
  ],
};

const MINOR_MODES = new Set<Mode>([
  'minor',
  'aeolian',
  'dorian',
  'phrygian',
  'locrian',
  'harmonicMinor',
  'melodicMinor',
]);

export interface Progression {
  /** e.g. 'I – V – vi – IV'. */
  readonly label: string;
  readonly chords: readonly DiatonicChord[];
}

/**
 * Suggested progressions for the key, resolved to its actual chords. Empty when
 * the key has no diatonic chords (pentatonic/blues) — there is nothing to build
 * a progression from.
 */
export function suggestedProgressions(key: SongKey): Progression[] {
  const chords = diatonicChords(key);
  if (chords.length < 7) return [];
  const family = MINOR_MODES.has(key.mode) ? 'minor' : 'major';
  return PROGRESSIONS[family].map((degrees) => {
    const picked = degrees.map((d) => chords[d - 1]!);
    return { label: picked.map((c) => c.roman).join(' – '), chords: picked };
  });
}

/** Classifies a pitch class against the key, for the fretboard overlay. */
export function scaleRole(pitchClass: number, info: ScaleInfo): ScaleRole {
  if (info.pitchClasses.length === 0) return 'none';
  if (pitchClass === info.pitchClasses[0]) return 'root';
  return info.pitchClasses.includes(pitchClass) ? 'scale' : 'none';
}
