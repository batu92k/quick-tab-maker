/**
 * The Quick Tab Maker song document.
 *
 * This is the single source of truth for a project: everything the renderer,
 * the audio engine and the PDF exporter need lives here, and nothing else is
 * persisted. It is plain JSON-serialisable data — no class instances, no
 * functions, no cyclic references — so a song round-trips through
 * `JSON.stringify` and IndexedDB without a custom serialiser.
 */

import type { Fraction } from './fraction';

/** Bumped whenever the shape changes; see `migrate.ts`. */
export const CURRENT_SCHEMA_VERSION = 2;

export type Id = string;

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

export type Technique =
  | 'hammer' // hammer-on from the previous note
  | 'pull' // pull-off from the previous note
  | 'slide' // legato slide into the next note
  | 'slideShift' // shift slide (re-picked)
  | 'bend'
  | 'vibrato'
  | 'palmMute'
  | 'ghost' // dead/muted note
  | 'harmonic'
  | 'tapping'
  | 'tie'; // tied from the previous note of the same string/fret

export interface Bend {
  /** Semitones bent up; 1 = whole fret, 0.5 = quarter tone. */
  readonly semitones: number;
  /** Whether the bend is released back down before the note ends. */
  readonly release: boolean;
}

/** A single fretted note on a guitar or bass track. */
export interface Note {
  readonly id: Id;
  /** Index into `StringTrack.tuning`. 0 is the LOWEST-pitched string. */
  readonly string: number;
  /** 0 = open string. Relative to the nut, before `capo` is applied. */
  readonly fret: number;
  readonly techniques: readonly Technique[];
  readonly bend?: Bend;
  /** MIDI velocity 1-127. Absent means "use the track default". */
  readonly velocity?: number;
}

export type DrumPiece =
  | 'kick'
  | 'snare'
  | 'sideStick'
  | 'hihat'
  | 'hihatOpen'
  | 'hihatPedal'
  | 'tom1'
  | 'tom2'
  | 'floorTom'
  | 'crash'
  | 'crash2'
  | 'ride'
  | 'rideBell'
  | 'china'
  | 'splash'
  | 'cowbell';

export type DrumArticulation = 'normal' | 'accent' | 'ghost' | 'flam' | 'drag' | 'roll' | 'choke';

export interface DrumNote {
  readonly id: Id;
  readonly piece: DrumPiece;
  readonly articulation: DrumArticulation;
  readonly velocity?: number;
}

export type AnyNote = Note | DrumNote;

/* -------------------------------------------------------------------------- */
/* Rhythm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One vertical slice of the tab — everything struck at the same instant.
 *
 * A beat with no notes is a rest. Beats within a measure are kept sorted by
 * `start` and must not overlap; `model/measure.ts` owns that invariant.
 */
export interface Beat<N extends AnyNote = AnyNote> {
  readonly id: Id;
  /** Offset from the start of the measure, in whole notes. */
  readonly start: Fraction;
  /** Sounding length, in whole notes. */
  readonly duration: Fraction;
  readonly notes: readonly N[];
  /** Tuplet grouping this beat belongs to, for rendering the bracket. */
  readonly tuplet?: { readonly actual: number; readonly normal: number };
}

export interface TimeSignature {
  readonly num: number;
  readonly den: number;
}

export interface Measure<N extends AnyNote = AnyNote> {
  readonly id: Id;
  /** Overrides the prevailing time signature from this measure onward. */
  readonly timeSig?: TimeSignature;
  readonly beats: readonly Beat<N>[];
  readonly repeatStart?: boolean;
  readonly repeatEnd?: { readonly times: number };
  /** Free-text marker shown above the staff, e.g. "Chorus". */
  readonly section?: string;
}

/* -------------------------------------------------------------------------- */
/* Tracks                                                                     */
/* -------------------------------------------------------------------------- */

export interface MixerSettings {
  /** 0-1, linear. Converted to dB by the audio engine. */
  readonly volume: number;
  /** -1 (hard left) to 1 (hard right). */
  readonly pan: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

interface TrackBase {
  readonly id: Id;
  readonly name: string;
  /** Key into the instrument registry in `audio/instruments`. */
  readonly instrumentId: string;
  readonly mixer: MixerSettings;
}

export interface StringTrack extends TrackBase {
  readonly kind: 'guitar' | 'bass';
  /**
   * Scientific pitch notation per string, LOWEST first.
   * Standard guitar: ['E2','A2','D3','G3','B3','E4'].
   * The array length is the string count, so 7-string and 5-string
   * instruments need no extra field.
   */
  readonly tuning: readonly string[];
  readonly fretCount: number;
  /** 0 = no capo. Adds this many semitones to every fretted and open note. */
  readonly capo: number;
  readonly measures: readonly Measure<Note>[];
}

export interface DrumTrack extends TrackBase {
  readonly kind: 'drums';
  /** Key into the kit registry; decides both the sound and the illustration. */
  readonly kitId: string;
  readonly measures: readonly Measure<DrumNote>[];
}

export type Track = StringTrack | DrumTrack;

export const isStringTrack = (t: Track): t is StringTrack =>
  t.kind === 'guitar' || t.kind === 'bass';

export const isDrumTrack = (t: Track): t is DrumTrack => t.kind === 'drums';

/* -------------------------------------------------------------------------- */
/* Song                                                                       */
/* -------------------------------------------------------------------------- */

/** A tempo change taking effect at the start of `bar` (0-indexed). */
export interface TempoMarker {
  readonly bar: number;
  readonly bpm: number;
}

/** A time signature change taking effect at the start of `bar` (0-indexed). */
export interface TimeSignatureMarker extends TimeSignature {
  readonly bar: number;
}

export type Mode =
  | 'major'
  | 'minor'
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues';

export interface SongKey {
  /** Note letter with optional accidental, e.g. 'E', 'F#', 'Bb'. */
  readonly tonic: string;
  readonly mode: Mode;
}

/**
 * A free-text note the user places on the sheet — "play x2", a fingering
 * reminder, a section cue. Pinned to a musical position rather than a pixel so
 * it rides with its bar when the score reflows and lands in the right place in
 * the PDF, which is what makes it useful as a printed cheat sheet.
 */
export interface Annotation {
  readonly id: Id;
  /** Bar it is anchored above, 0-indexed. */
  readonly bar: number;
  /** Position within the bar, in whole notes. Zero pins it to the downbeat. */
  readonly offset: Fraction;
  readonly text: string;
}

export interface Song {
  readonly id: Id;
  readonly schemaVersion: number;
  readonly title: string;
  readonly artist: string;
  /** ISO-8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;

  /** Always non-empty and sorted by bar; index 0 is the song's initial tempo. */
  readonly tempoMap: readonly TempoMarker[];
  /** Always non-empty and sorted by bar; index 0 is the opening time signature. */
  readonly timeSignatures: readonly TimeSignatureMarker[];
  readonly key: SongKey;

  readonly tracks: readonly Track[];

  /** Free-text notes on the sheet, sorted by bar then offset. */
  readonly annotations: readonly Annotation[];
}

/* -------------------------------------------------------------------------- */
/* Editor cursor                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Where note entry lands. Kept in the store rather than the document so it is
 * never persisted, but declared here because it is addressed in document terms.
 */
export interface Cursor {
  readonly trackId: Id;
  readonly measureIndex: number;
  readonly beatIndex: number;
  /** String index for string tracks, or drum-piece row index for drum tracks. */
  readonly line: number;
  /**
   * When set, the cursor sits *between* notes: note entry inserts a new note at
   * this position in the bar, splitting whatever beat it lands inside, rather
   * than editing `beatIndex`. Set by clicking the sheet on a grid line between
   * two notes; cleared by arrow movement and once a note is placed.
   */
  readonly insertAt?: Fraction;
}
