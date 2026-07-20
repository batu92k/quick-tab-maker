/**
 * Reading and writing `.qtm` song files.
 *
 * The document is already plain JSON — fractions are `{n, d}` objects, not
 * class instances — so serialising is `JSON.stringify`. The work is all on the
 * way in: an imported file is untrusted input that will be handed straight to
 * the renderer and the audio engine, and a malformed one must fail at the
 * boundary with a message a user can act on, rather than throwing somewhere
 * deep in a render loop.
 */

import { migrate } from './migrate';
import { CURRENT_SCHEMA_VERSION, type Song } from './types';

export const FILE_EXTENSION = '.qtm';
export const FILE_MIME_TYPE = 'application/json';

export class SongParseError extends Error {
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'SongParseError';
    this.path = path;
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function fail(message: string, path: string): never {
  throw new SongParseError(message, path);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string') fail('expected a string', path);
  return v;
}

function requireNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('expected a finite number', path);
  return v;
}

function requireArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail('expected an array', path);
  return v;
}

/** Fractions arrive as bare JSON, so the invariants have to be re-checked. */
function validateFraction(v: unknown, path: string): void {
  if (!isRecord(v)) fail('expected a fraction object', path);
  const n = requireNumber(v.n, `${path}.n`);
  const d = requireNumber(v.d, `${path}.d`);
  if (!Number.isInteger(n) || !Number.isInteger(d)) fail('fraction parts must be integers', path);
  if (d <= 0) fail('fraction denominator must be positive', path);
}

function validateBeat(v: unknown, path: string): void {
  if (!isRecord(v)) fail('expected a beat object', path);
  requireString(v.id, `${path}.id`);
  validateFraction(v.start, `${path}.start`);
  validateFraction(v.duration, `${path}.duration`);
  const notes = requireArray(v.notes, `${path}.notes`);
  notes.forEach((note, i) => {
    const notePath = `${path}.notes[${i}]`;
    if (!isRecord(note)) fail('expected a note object', notePath);
    requireString(note.id, `${notePath}.id`);
    // A note is either fretted (string/fret) or percussive (piece). Anything
    // else would reach the audio engine as an unplayable note.
    const isFretted = 'string' in note && 'fret' in note;
    const isDrum = 'piece' in note;
    if (!isFretted && !isDrum) fail('note has neither string/fret nor piece', notePath);
    if (isFretted) {
      requireNumber(note.string, `${notePath}.string`);
      requireNumber(note.fret, `${notePath}.fret`);
      requireArray(note.techniques ?? [], `${notePath}.techniques`);
    } else {
      requireString(note.piece, `${notePath}.piece`);
    }
  });
}

function validateMeasure(v: unknown, path: string): void {
  if (!isRecord(v)) fail('expected a measure object', path);
  requireString(v.id, `${path}.id`);
  const beats = requireArray(v.beats, `${path}.beats`);
  beats.forEach((beat, i) => validateBeat(beat, `${path}.beats[${i}]`));
}

function validateTrack(v: unknown, path: string): void {
  if (!isRecord(v)) fail('expected a track object', path);
  requireString(v.id, `${path}.id`);
  requireString(v.name, `${path}.name`);
  const kind = requireString(v.kind, `${path}.kind`);
  if (kind !== 'guitar' && kind !== 'bass' && kind !== 'drums') {
    fail(`unknown track kind ${JSON.stringify(kind)}`, `${path}.kind`);
  }
  if (kind === 'guitar' || kind === 'bass') {
    const tuning = requireArray(v.tuning, `${path}.tuning`);
    if (tuning.length === 0) fail('tuning must have at least one string', `${path}.tuning`);
    tuning.forEach((p, i) => requireString(p, `${path}.tuning[${i}]`));
    requireNumber(v.fretCount, `${path}.fretCount`);
  }
  const measures = requireArray(v.measures, `${path}.measures`);
  measures.forEach((m, i) => validateMeasure(m, `${path}.measures[${i}]`));
}

/**
 * Checks that a migrated document really is a `Song`.
 *
 * This is a structural check, not an exhaustive one: it verifies everything the
 * renderer and audio engine dereference without guarding, and leaves cosmetic
 * fields to their defaults.
 */
export function validateSong(raw: unknown): Song {
  if (!isRecord(raw)) fail('expected a song object', '$');
  requireString(raw.id, '$.id');
  requireString(raw.title, '$.title');

  const tempoMap = requireArray(raw.tempoMap, '$.tempoMap');
  if (tempoMap.length === 0) fail('a song needs at least one tempo marker', '$.tempoMap');
  tempoMap.forEach((m, i) => {
    if (!isRecord(m)) fail('expected a tempo marker', `$.tempoMap[${i}]`);
    requireNumber(m.bar, `$.tempoMap[${i}].bar`);
    const bpm = requireNumber(m.bpm, `$.tempoMap[${i}].bpm`);
    if (bpm <= 0) fail('tempo must be positive', `$.tempoMap[${i}].bpm`);
  });

  const timeSignatures = requireArray(raw.timeSignatures, '$.timeSignatures');
  if (timeSignatures.length === 0) {
    fail('a song needs at least one time signature', '$.timeSignatures');
  }
  timeSignatures.forEach((m, i) => {
    if (!isRecord(m)) fail('expected a time signature marker', `$.timeSignatures[${i}]`);
    const num = requireNumber(m.num, `$.timeSignatures[${i}].num`);
    const den = requireNumber(m.den, `$.timeSignatures[${i}].den`);
    if (num < 1 || den < 1) fail('time signature parts must be positive', `$.timeSignatures[${i}]`);
  });

  if (!isRecord(raw.key)) fail('expected a key object', '$.key');
  requireString(raw.key.tonic, '$.key.tonic');
  requireString(raw.key.mode, '$.key.mode');

  const tracks = requireArray(raw.tracks, '$.tracks');
  if (tracks.length === 0) fail('a song needs at least one track', '$.tracks');
  tracks.forEach((t, i) => validateTrack(t, `$.tracks[${i}]`));

  return raw as unknown as Song;
}

/* -------------------------------------------------------------------------- */
/* Serialisation                                                              */
/* -------------------------------------------------------------------------- */

/** Serialises a song for download. Pretty-printed so files diff readably. */
export function songToJson(song: Song, pretty = true): string {
  return JSON.stringify(song, null, pretty ? 2 : 0);
}

/** Parses, migrates and validates a `.qtm` file's contents. */
export function songFromJson(text: string): Song {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SongParseError(
      `File is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateSong(migrate(parsed));
}

/** Deep-clones a song. Used for duplication and for import isolation. */
export function cloneSong(song: Song): Song {
  return structuredClone(song) as Song;
}

/** A filesystem-safe filename derived from the song title. */
export function suggestedFilename(song: Song): string {
  const base = song.title.trim().replace(/[^\w\d\-_ ]+/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'untitled-song'}${FILE_EXTENSION}`;
}

export { CURRENT_SCHEMA_VERSION };
