/**
 * Application shell.
 *
 * Phase 2 renders the demo song read-only to prove the layout engine end to
 * end. Phase 3 replaces the placeholder header with the real transport and
 * wires pointer input on the score to the editing cursor.
 */

import { useEffect, useState } from 'react';
import { demoSong } from './model/fixtures';
import { ScoreView } from './render/ScoreView';
import { useSongStore } from './store/songStore';
import './App.css';

type Theme = 'light' | 'dark';

function App() {
  const song = useSongStore((s) => s.song);
  const openSong = useSongStore((s) => s.openSong);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Load the demo song on first run so there is something to look at before
    // the song manager exists. Phase 9 replaces this with the real song list.
    if (!song) openSong(demoSong());
  }, [song, openSong]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="qtm-app">
      <header className="qtm-header">
        <div>
          <h1>{song?.title ?? 'Quick Tab Maker'}</h1>
          {song && (
            <p className="qtm-subtitle">
              {song.artist} &middot; {song.key.tonic} {song.key.mode} &middot;{' '}
              {song.tempoMap[0]?.bpm} BPM
            </p>
          )}
        </div>
        <button
          type="button"
          className="qtm-button"
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        >
          {theme === 'light' ? 'Dark' : 'Light'} theme
        </button>
      </header>

      <main className="qtm-main">{song && <ScoreView song={song} />}</main>
    </div>
  );
}

export default App;
