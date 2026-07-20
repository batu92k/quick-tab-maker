/**
 * IndexedDB persistence for songs and preferences.
 *
 * Songs are stored as whole documents keyed by id. That is the right shape for
 * this app: edits are small but a song is only a few hundred kilobytes, reads
 * are always "load one entire song", and a whole-document write is atomic —
 * which matters far more than write efficiency when the alternative is a
 * half-saved song after a crash.
 *
 * Every function here degrades gracefully. IndexedDB is unavailable in private
 * windows in some browsers and can fail on a full disk, and losing persistence
 * should never take the editor down with it.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { migrate } from '../model/migrate';
import { validateSong } from '../model/serialize';
import type { Song } from '../model/types';

const DB_NAME = 'quick-tab-maker';
const DB_VERSION = 1;
const SONG_STORE = 'songs';
const PREFS_STORE = 'preferences';

/** Listing metadata, so the song list does not deserialise every document. */
export interface SongSummary {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly trackCount: number;
  readonly barCount: number;
}

interface QtmSchema extends DBSchema {
  [SONG_STORE]: {
    key: string;
    value: Song;
    indexes: { 'by-updated': string };
  };
  [PREFS_STORE]: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<QtmSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<QtmSchema>> {
  dbPromise ??= openDB<QtmSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SONG_STORE)) {
        const store = db.createObjectStore(SONG_STORE, { keyPath: 'id' });
        store.createIndex('by-updated', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(PREFS_STORE)) {
        db.createObjectStore(PREFS_STORE);
      }
    },
    blocked() {
      console.warn('[persistence] Upgrade blocked by another open tab');
    },
  });
  return dbPromise;
}

/** True when songs can actually be persisted in this browser/context. */
export async function isAvailable(): Promise<boolean> {
  try {
    await getDb();
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Songs                                                                      */
/* -------------------------------------------------------------------------- */

export async function saveSong(song: Song): Promise<void> {
  const db = await getDb();
  // `structuredClone` up front: IndexedDB clones on write anyway, and doing it
  // here surfaces a non-serialisable value as a clear error at the call site
  // rather than an opaque DataCloneError from the transaction.
  await db.put(SONG_STORE, structuredClone(song));
}

/**
 * Loads a song, migrating and validating it on the way out.
 *
 * A document can be older than the running app (saved before an update) or
 * corrupt (a half-written record, or a bug in an earlier version), so the same
 * checks that guard file import guard the database too.
 */
export async function loadSong(id: string): Promise<Song | undefined> {
  const db = await getDb();
  const raw = await db.get(SONG_STORE, id);
  if (!raw) return undefined;
  return validateSong(migrate(raw));
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(SONG_STORE, id);
}

/** Every song's metadata, most recently edited first. */
export async function listSongs(): Promise<SongSummary[]> {
  const db = await getDb();
  const songs = await db.getAll(SONG_STORE);
  return songs
    .map(
      (song): SongSummary => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        updatedAt: song.updatedAt,
        createdAt: song.createdAt,
        trackCount: song.tracks.length,
        barCount: song.tracks.reduce((max, t) => Math.max(max, t.measures.length), 0),
      }),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Id of the most recently edited song, for reopening on launch. */
export async function mostRecentSongId(): Promise<string | undefined> {
  const db = await getDb();
  const cursor = await db.transaction(SONG_STORE).store.index('by-updated').openCursor(null, 'prev');
  return cursor?.value.id;
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

export async function getPreference<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  return (await db.get(PREFS_STORE, key)) as T | undefined;
}

export async function setPreference(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put(PREFS_STORE, structuredClone(value), key);
}

/* -------------------------------------------------------------------------- */
/* Autosave                                                                   */
/* -------------------------------------------------------------------------- */

export interface Autosaver {
  /** Queues a save, restarting the debounce window. */
  schedule(song: Song): void;
  /** Writes any pending song immediately. */
  flush(): Promise<void>;
  dispose(): void;
}

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Debounced autosave.
 *
 * Typing a run of notes produces an edit per keystroke; writing on each one
 * would hammer IndexedDB for no benefit. The pending song is held by reference
 * and overwritten, so only the latest state is ever written.
 */
export function createAutosaver(
  onStatus: (status: AutosaveStatus, error?: unknown) => void,
  delayMs = 800,
): Autosaver {
  let pending: Song | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let disposed = false;

  async function write(): Promise<void> {
    const song = pending;
    pending = null;
    if (!song || disposed) return;
    onStatus('saving');
    try {
      await saveSong(song);
      onStatus('saved');
    } catch (error) {
      // Autosave failures must not surface as a thrown error in the edit path;
      // the UI shows the status instead so the user can export a file manually.
      console.error('[persistence] Autosave failed', error);
      onStatus('error', error);
    }
  }

  return {
    schedule(song) {
      if (disposed) return;
      pending = song;
      onStatus('pending');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        inFlight = inFlight.then(write);
      }, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      inFlight = inFlight.then(write);
      await inFlight;
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
