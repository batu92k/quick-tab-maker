/**
 * Schema migrations for saved songs.
 *
 * This exists at version 1 with nothing to do yet, deliberately. Songs are user
 * data that outlives any single release, and retrofitting a migration path
 * after the first breaking change means the first change is the one that eats
 * people's work. The pipeline is cheap now and impossible to add later.
 *
 * To add a migration: write a function from version N to N+1, register it in
 * `MIGRATIONS`, and bump `CURRENT_SCHEMA_VERSION` in `types.ts`.
 */

import { CURRENT_SCHEMA_VERSION } from './types';
import type { Song } from './types';

/**
 * Migrations operate on loosely-typed documents: an old song does not satisfy
 * the current `Song` type, which is the entire reason it needs migrating.
 */
type UnknownSong = Record<string, unknown>;

type Migration = (song: UnknownSong) => UnknownSong;

/** Keyed by the version being migrated *from*. */
const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2 added on-sheet text annotations. Older songs simply have none, so the
  // migration is to give the field its empty default — but it still has to
  // exist, because the rest of the app now dereferences `song.annotations`
  // without guarding, and an absent field would fault on the first render.
  1: (song) => ({
    ...song,
    schemaVersion: 2,
    annotations: Array.isArray(song.annotations) ? song.annotations : [],
  }),
};

export class MigrationError extends Error {
  readonly fromVersion: number;

  constructor(message: string, fromVersion: number) {
    super(message);
    this.name = 'MigrationError';
    this.fromVersion = fromVersion;
  }
}

/**
 * Brings a stored document up to the current schema version.
 *
 * Throws rather than guessing when a document comes from a newer version of the
 * app than this one — silently dropping fields it does not understand would
 * quietly destroy work made on another device.
 */
export function migrate(raw: unknown): Song {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('Song document is not an object', -1);
  }

  let song = raw as UnknownSong;
  let version = typeof song.schemaVersion === 'number' ? song.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `This song was saved by a newer version of Quick Tab Maker (schema ${version}, this app supports ${CURRENT_SCHEMA_VERSION}). Update the app to open it.`,
      version,
    );
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new MigrationError(`No migration registered from schema version ${version}`, version);
    }
    song = step(song);
    const next = typeof song.schemaVersion === 'number' ? song.schemaVersion : version;
    if (next <= version) {
      throw new MigrationError(`Migration from version ${version} did not advance the version`, version);
    }
    version = next;
  }

  return song as unknown as Song;
}

export function needsMigration(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const version = (raw as UnknownSong).schemaVersion;
  return typeof version === 'number' && version < CURRENT_SCHEMA_VERSION;
}
