/**
 * The editor store: the open song, the cursor, and the undo history.
 *
 * Every document change goes through `edit()`, which runs an `edit.ts`
 * operation inside `produceWithPatches`. Recording patch pairs rather than
 * whole-document snapshots keeps history cheap on long songs, and it means undo
 * restores exactly what changed instead of resurrecting stale state elsewhere.
 */

import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import * as F from './../model/fraction';
import type { Fraction } from './../model/fraction';
import { cloneSong } from '../model/serialize';
import { createSong } from '../model/song';
import { newSongId } from '../model/ids';
import type { Cursor, Id, Song } from '../model/types';
import { DRUM_ROW_COUNT } from '../theory/drums';
import {
  createAutosaver,
  saveSong,
  type AutosaveStatus,
  type Autosaver,
} from './persistence';

enablePatches();

/** How many undo steps to keep. Bounded so a long session cannot grow forever. */
const HISTORY_LIMIT = 200;

interface HistoryEntry {
  readonly patches: Patch[];
  readonly inversePatches: Patch[];
  /** Shown in the UI and used to decide whether edits coalesce. */
  readonly label: string;
  readonly at: number;
}

export interface EditorState {
  song: Song | null;
  cursor: Cursor | null;
  /** Duration applied to newly entered notes. */
  entryDuration: Fraction;
  past: HistoryEntry[];
  future: HistoryEntry[];
  autosaveStatus: AutosaveStatus;
  autosaveError: unknown;

  /* Document lifecycle */
  openSong: (song: Song) => void;
  newSong: () => void;
  closeSong: () => Promise<void>;
  duplicateSong: () => Song | null;

  /* Editing */
  edit: (label: string, recipe: (draft: Draft<Song>) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  /* Cursor */
  setCursor: (cursor: Cursor | null) => void;
  moveCursor: (delta: { measure?: number; beat?: number; line?: number }) => void;
  setEntryDuration: (duration: Fraction) => void;

  /* Persistence */
  saveNow: () => Promise<void>;
}

let autosaver: Autosaver | null = null;

function getAutosaver(): Autosaver {
  autosaver ??= createAutosaver((status, error) => {
    useSongStore.setState({ autosaveStatus: status, autosaveError: error });
  });
  return autosaver;
}

export const useSongStore = create<EditorState>((set, get) => ({
  song: null,
  cursor: null,
  entryDuration: F.QUARTER,
  past: [],
  future: [],
  autosaveStatus: 'idle',
  autosaveError: undefined,

  /* ---------------------------------------------------------------------- */

  openSong(song) {
    set({
      song,
      // A fresh document gets a fresh history: undoing past the point where a
      // song was opened would apply patches to a document they never came from.
      past: [],
      future: [],
      cursor: song.tracks[0]
        ? { trackId: song.tracks[0].id, measureIndex: 0, beatIndex: 0, line: 0 }
        : null,
      autosaveStatus: 'idle',
      autosaveError: undefined,
    });
  },

  newSong() {
    const song = createSong();
    get().openSong(song);
    // Persist immediately so a new song survives a reload even if the user
    // never types anything, which is what makes the song list trustworthy.
    void saveSong(song).catch((error) => {
      console.error('[store] Failed to save new song', error);
    });
  },

  async closeSong() {
    await getAutosaver().flush();
    set({ song: null, cursor: null, past: [], future: [], autosaveStatus: 'idle' });
  },

  duplicateSong() {
    const song = get().song;
    if (!song) return null;
    const now = new Date().toISOString();
    const copy: Song = {
      ...cloneSong(song),
      id: newSongId(),
      title: `${song.title} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    void saveSong(copy).catch((error) => console.error('[store] Failed to save copy', error));
    return copy;
  },

  /* ---------------------------------------------------------------------- */

  edit(label, recipe) {
    const { song, past } = get();
    if (!song) return;

    const [next, patches, inversePatches] = produceWithPatches(song, recipe);

    // An operation that declined to apply (returned false and touched nothing)
    // produces no patches. Recording an empty entry would make undo appear
    // broken — the user presses it and nothing visibly happens.
    if (patches.length === 0) return;

    const entry: HistoryEntry = { patches, inversePatches, label, at: Date.now() };
    const trimmed = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past;

    set({
      song: next,
      past: [...trimmed, entry],
      // Any new edit invalidates the redo branch.
      future: [],
    });
    getAutosaver().schedule(next);
  },

  undo() {
    const { song, past, future } = get();
    const entry = past[past.length - 1];
    if (!song || !entry) return;

    const restored = applyPatches(song, entry.inversePatches);
    set({ song: restored, past: past.slice(0, -1), future: [entry, ...future] });
    getAutosaver().schedule(restored);
  },

  redo() {
    const { song, past, future } = get();
    const entry = future[0];
    if (!song || !entry) return;

    const restored = applyPatches(song, entry.patches);
    set({ song: restored, past: [...past, entry], future: future.slice(1) });
    getAutosaver().schedule(restored);
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  clearHistory: () => set({ past: [], future: [] }),

  /* ---------------------------------------------------------------------- */

  setCursor: (cursor) => set({ cursor }),

  moveCursor(delta) {
    const { song, cursor } = get();
    if (!song || !cursor) return;

    const track = song.tracks.find((t) => t.id === cursor.trackId);
    if (!track) return;

    const measureIndex = clamp(
      cursor.measureIndex + (delta.measure ?? 0),
      0,
      Math.max(0, track.measures.length - 1),
    );
    const measure = track.measures[measureIndex];
    // The cursor may sit one slot past the last beat: that is the position
    // where the next note gets appended, so it has to be reachable.
    const maxBeat = measure ? measure.beats.length : 0;
    const beatIndex = clamp(cursor.beatIndex + (delta.beat ?? 0), 0, maxBeat);
    const lineCount = track.kind === 'drums' ? DRUM_ROW_COUNT : track.tuning.length;
    const line = clamp(cursor.line + (delta.line ?? 0), 0, lineCount - 1);

    set({ cursor: { trackId: cursor.trackId, measureIndex, beatIndex, line } });
  },

  setEntryDuration: (entryDuration) => set({ entryDuration }),

  async saveNow() {
    const song = get().song;
    if (!song) return;
    await getAutosaver().flush();
    await saveSong(song);
    set({ autosaveStatus: 'saved' });
  },
}));

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

export const selectSong = (s: EditorState): Song | null => s.song;
export const selectCursor = (s: EditorState): Cursor | null => s.cursor;

export const selectCurrentTrack = (s: EditorState) =>
  s.song && s.cursor ? s.song.tracks.find((t) => t.id === s.cursor!.trackId) : undefined;

export function selectTrackById(s: EditorState, trackId: Id) {
  return s.song?.tracks.find((t) => t.id === trackId);
}

/** Exposed for tests, which need a clean store between cases. */
export function resetStoreForTesting(): void {
  autosaver?.dispose();
  autosaver = null;
  useSongStore.setState({
    song: null,
    cursor: null,
    entryDuration: F.QUARTER,
    past: [],
    future: [],
    autosaveStatus: 'idle',
    autosaveError: undefined,
  });
}
