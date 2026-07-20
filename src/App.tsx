/**
 * Application shell.
 *
 * Phase 3 makes the score editable: click to place the cursor, type to enter
 * frets, and undo/redo. The transport and instrument panels arrive in later
 * phases and slot in around this same layout.
 */

import { useCallback, useEffect, useState } from 'react';
import { EditorToolbar } from './editor/EditorToolbar';
import { Notice } from './editor/Notice';
import { ShortcutSheet } from './editor/ShortcutSheet';
import { useEditorKeyboard } from './editor/useEditorKeyboard';
import { demoSong } from './model/fixtures';
import { ScoreView } from './render/ScoreView';
import type { HitResult } from './render/layout';
import { useSongStore } from './store/songStore';
import './App.css';

type Theme = 'light' | 'dark';

function App() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const setCursor = useSongStore((s) => s.setCursor);
  const openSong = useSongStore((s) => s.openSong);
  const autosaveStatus = useSongStore((s) => s.autosaveStatus);

  const [theme, setTheme] = useState<Theme>('light');
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEditorKeyboard(true);

  useEffect(() => {
    // Load the demo song on first run so there is something to edit before the
    // song manager exists. Phase 9 replaces this with the real song list.
    if (!song) openSong(demoSong());
  }, [song, openSong]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const handleHit = useCallback(
    (hit: HitResult) => {
      setCursor({
        trackId: hit.trackId,
        measureIndex: hit.measureIndex,
        beatIndex: hit.beatIndex,
        line: hit.line,
      });
    },
    [setCursor],
  );

  return (
    <div className="qtm-app">
      <header className="qtm-header">
        <div>
          <h1>{song?.title ?? 'Quick Tab Maker'}</h1>
          {song && (
            <p className="qtm-subtitle">
              {song.artist} &middot; {song.key.tonic} {song.key.mode} &middot;{' '}
              {song.tempoMap[0]?.bpm} BPM
              {autosaveStatus === 'saved' && <> &middot; saved</>}
              {autosaveStatus === 'error' && <> &middot; not saved</>}
            </p>
          )}
        </div>
        <div className="qtm-header-actions">
          <button type="button" className="qtm-button" onClick={() => setShowShortcuts(true)}>
            Shortcuts
          </button>
          <button
            type="button"
            className="qtm-button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? 'Dark' : 'Light'} theme
          </button>
        </div>
      </header>

      {song && <EditorToolbar />}

      <main className="qtm-main">
        {song && <ScoreView song={song} cursor={cursor} onHit={handleHit} />}
        <p className="qtm-hint">
          Click a position, then type a fret number. Arrow keys move, <kbd>[</kbd> and{' '}
          <kbd>]</kbd> change the note value, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.
        </p>
      </main>

      <Notice />

      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
