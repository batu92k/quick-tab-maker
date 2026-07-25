/**
 * The song library: the app's home surface.
 *
 * Lists every saved song and offers the six manager actions — open, create,
 * duplicate, rename, delete, import and export. Open/rename/delete go through
 * the song store, since they touch the document that may be open in the editor;
 * duplicate/import/export are plain library calls. After any change the list is
 * re-read from IndexedDB rather than patched locally, so it can never drift from
 * what is actually stored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SongParseError } from '../model/serialize';
import { useSongStore } from '../store/songStore';
import {
  duplicateSongById,
  exportSongToFile,
  importSongFromFile,
  listSongs,
  type SongSummary,
} from './library';
import './library.css';

export interface SongLibraryProps {
  currentSongId: string | null;
  onClose: () => void;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SongLibrary({ currentSongId, onClose }: SongLibraryProps) {
  const openById = useSongStore((s) => s.openById);
  const newSong = useSongStore((s) => s.newSong);
  const renameSong = useSongStore((s) => s.renameSong);
  const deleteSongById = useSongStore((s) => s.deleteSongById);

  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string; artist: string } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSongs(await listSongs());
    } catch (e) {
      console.error('[library] Failed to list songs', e);
      setError('Could not read your songs from this browser.');
      setSongs([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Serialises actions behind a busy flag so a double-click can't, say, delete a
  // song twice or race two opens.
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);

  const handleOpen = (id: string) =>
    run(async () => {
      await openById(id);
      onClose();
    });

  const handleNew = () =>
    run(async () => {
      await newSong();
      onClose();
    });

  const handleDuplicate = (id: string) =>
    run(async () => {
      await duplicateSongById(id);
      await refresh();
    });

  const handleDelete = (id: string) =>
    run(async () => {
      await deleteSongById(id);
      setConfirmingDelete(null);
      await refresh();
    });

  const handleRenameSave = () => {
    if (!renaming) return;
    const { id, title, artist } = renaming;
    return run(async () => {
      await renameSong(id, title, artist);
      setRenaming(null);
      await refresh();
    });
  };

  const handleExport = (id: string) =>
    run(async () => {
      await exportSongToFile(id);
    });

  const handleImportFile = (file: File) =>
    run(async () => {
      try {
        await importSongFromFile(file);
        await refresh();
      } catch (e) {
        setError(
          e instanceof SongParseError
            ? `That file could not be imported: ${e.message}`
            : 'That file could not be imported.',
        );
      }
    });

  return (
    <div className="qtm-library">
      <header className="qtm-library-header">
        <div>
          <h1>Your songs</h1>
          <p className="qtm-library-sub">
            {songs === null ? 'Loading…' : `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`}
          </p>
        </div>
        <div className="qtm-library-actions">
          {currentSongId && (
            <button type="button" className="qtm-button" onClick={onClose} disabled={busy}>
              ← Back to editor
            </button>
          )}
          <button type="button" className="qtm-button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import .qtm
          </button>
          <button
            type="button"
            className="qtm-button qtm-button--primary"
            onClick={handleNew}
            disabled={busy}
          >
            + New song
          </button>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept=".qtm,application/json"
        className="qtm-visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so choosing the same file again still fires a change event.
          e.target.value = '';
          if (file) void handleImportFile(file);
        }}
      />

      {error && (
        <div className="qtm-library-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {songs !== null && songs.length === 0 && (
        <div className="qtm-library-empty">
          <p>No songs yet.</p>
          <p className="qtm-library-sub">Create one, or import a .qtm file you exported before.</p>
        </div>
      )}

      {songs && songs.length > 0 && (
        <ul className="qtm-song-list">
          {songs.map((song) => {
            const isCurrent = song.id === currentSongId;
            const isRenaming = renaming?.id === song.id;
            const isConfirming = confirmingDelete === song.id;
            return (
              <li key={song.id} className={`qtm-song-card${isCurrent ? ' qtm-song-card--current' : ''}`}>
                {isRenaming ? (
                  <form
                    className="qtm-song-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRenameSave();
                    }}
                  >
                    <input
                      className="qtm-input"
                      value={renaming.title}
                      placeholder="Title"
                      aria-label="Song title"
                      autoFocus
                      onChange={(e) => setRenaming({ ...renaming, title: e.target.value })}
                    />
                    <input
                      className="qtm-input"
                      value={renaming.artist}
                      placeholder="Artist"
                      aria-label="Artist"
                      onChange={(e) => setRenaming({ ...renaming, artist: e.target.value })}
                    />
                    <div className="qtm-song-card-actions">
                      <button type="submit" className="qtm-button qtm-button--primary" disabled={busy}>
                        Save
                      </button>
                      <button type="button" className="qtm-button" onClick={() => setRenaming(null)} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="qtm-song-info">
                      <button
                        type="button"
                        className="qtm-song-title"
                        onClick={() => handleOpen(song.id)}
                        disabled={busy}
                      >
                        {song.title || 'Untitled Song'}
                        {isCurrent && <span className="qtm-song-badge">Open</span>}
                      </button>
                      <p className="qtm-song-meta">
                        {song.artist ? `${song.artist} · ` : ''}
                        {song.trackCount} {song.trackCount === 1 ? 'track' : 'tracks'} ·{' '}
                        {song.barCount} {song.barCount === 1 ? 'bar' : 'bars'} · {formatWhen(song.updatedAt)}
                      </p>
                    </div>

                    {isConfirming ? (
                      <div className="qtm-song-card-actions">
                        <span className="qtm-song-confirm">Delete this song?</span>
                        <button type="button" className="qtm-button qtm-button--danger" onClick={() => handleDelete(song.id)} disabled={busy}>
                          Delete
                        </button>
                        <button type="button" className="qtm-button" onClick={() => setConfirmingDelete(null)} disabled={busy}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="qtm-song-card-actions">
                        <button type="button" className="qtm-button" onClick={() => handleOpen(song.id)} disabled={busy}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="qtm-button"
                          onClick={() => setRenaming({ id: song.id, title: song.title, artist: song.artist })}
                          disabled={busy}
                        >
                          Rename
                        </button>
                        <button type="button" className="qtm-button" onClick={() => handleDuplicate(song.id)} disabled={busy}>
                          Duplicate
                        </button>
                        <button type="button" className="qtm-button" onClick={() => handleExport(song.id)} disabled={busy}>
                          Export
                        </button>
                        <button type="button" className="qtm-button" onClick={() => setConfirmingDelete(song.id)} disabled={busy}>
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
