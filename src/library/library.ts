/**
 * Song-library operations that stand apart from the open document: duplicating,
 * importing a `.qtm` file and exporting one. Opening, renaming and deleting can
 * affect the song currently being edited, so those live on the song store where
 * the autosaver and open-song state are; these do not, so they are plain
 * functions over persistence and serialisation.
 */

import { newSongId } from '../model/ids';
import { cloneSong, songFromJson, songToJson, suggestedFilename } from '../model/serialize';
import type { Song } from '../model/types';
import { loadSong, saveSong } from '../store/persistence';

export { listSongs, type SongSummary } from '../store/persistence';

/** Deep-copies a saved song under a new id and title, and saves the copy. */
export async function duplicateSongById(id: string): Promise<Song | undefined> {
  const song = await loadSong(id);
  if (!song) return undefined;
  const now = new Date().toISOString();
  const copy: Song = {
    ...cloneSong(song),
    id: newSongId(),
    title: `${song.title} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await saveSong(copy);
  return copy;
}

/**
 * Reads a `.qtm` file into a new library entry. Always takes a fresh id, so
 * importing a file that was exported from this same library adds a copy rather
 * than silently overwriting the original. Throws `SongParseError` on bad input.
 */
export async function importSongFromFile(file: File): Promise<Song> {
  const parsed = songFromJson(await file.text());
  const imported: Song = { ...parsed, id: newSongId(), updatedAt: new Date().toISOString() };
  await saveSong(imported);
  return imported;
}

/** Downloads a saved song as a `.qtm` file. */
export async function exportSongToFile(id: string): Promise<void> {
  const song = await loadSong(id);
  if (!song) return;
  downloadText(songToJson(song), suggestedFilename(song), 'application/json');
}

function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
