/**
 * Application shell.
 *
 * Phase 3 makes the score editable: click to place the cursor, type to enter
 * frets, and undo/redo. The transport and instrument panels arrive in later
 * phases and slot in around this same layout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as C from './editor/commands';
import { InstrumentPanel } from './components/InstrumentPanel';
import { Mixer } from './components/Mixer';
import { TheoryPanel } from './components/TheoryPanel';
import { Transport } from './components/Transport';
import type { ScaleOverlay } from './components/Fretboard';
import { scaleInfo, type DiatonicChord } from './theory/scale';
import { EditorToolbar } from './editor/EditorToolbar';
import { Notice } from './editor/Notice';
import { ShortcutSheet } from './editor/ShortcutSheet';
import { useEditorKeyboard } from './editor/useEditorKeyboard';
import { demoSong } from './model/fixtures';
import { ScoreView } from './render/ScoreView';
import type { HitResult } from './render/layout';
import { usePlaybackStore } from './store/playbackStore';
import { useSongStore } from './store/songStore';
import './App.css';

type Theme = 'light' | 'dark';

function App() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const setCursor = useSongStore((s) => s.setCursor);
  const openSong = useSongStore((s) => s.openSong);
  const autosaveStatus = useSongStore((s) => s.autosaveStatus);
  const playhead = usePlaybackStore((s) => s.position);
  const snap = usePlaybackStore((s) => s.snap);
  const scrubTo = usePlaybackStore((s) => s.scrubTo);

  const [theme, setTheme] = useState<Theme>('light');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [selectedChord, setSelectedChord] = useState<DiatonicChord | null>(null);
  // Id of a note just added, so its input can grab focus for typing. Cleared on
  // blur so the same box is not re-focused on later renders.
  const [autoFocusAnnotation, setAutoFocusAnnotation] = useState<string | undefined>(undefined);

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
        ...(hit.insertAt !== undefined ? { insertAt: hit.insertAt } : {}),
      });
    },
    [setCursor],
  );

  const handleAddText = useCallback(() => {
    const id = C.addAnnotationAtCursor();
    if (id) setAutoFocusAnnotation(id);
  }, []);

  const handleAnnotationCommit = useCallback((id: string) => {
    C.removeAnnotationIfEmpty(id);
    setAutoFocusAnnotation((current) => (current === id ? undefined : current));
  }, []);

  const handleChangeKey = useCallback((key: NonNullable<typeof song>['key']) => {
    // A chord from the old key may not exist in the new one, so drop the
    // selection rather than leave a stale highlight on the neck.
    setSelectedChord(null);
    C.setKey(key);
  }, []);

  // The scale guide painted on the fretboard. Built only when the user has asked
  // to see the scale or has picked a chord, so the neck stays clean otherwise.
  const scaleOverlay = useMemo<ScaleOverlay | null>(() => {
    if (!song || (!showScale && !selectedChord)) return null;
    const info = scaleInfo(song.key);
    return {
      pitchClasses: showScale ? info.pitchClasses : [],
      root: info.pitchClasses[0] ?? 0,
      chord: selectedChord?.pitchClasses,
    };
  }, [song, showScale, selectedChord]);

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

      {song && (
        <div className="qtm-controls">
          <Transport />
          <Mixer />
        </div>
      )}

      {song && <EditorToolbar />}

      <main className="qtm-main">
        {song && (
          <div className="qtm-sheet-tools">
            <button type="button" className="qtm-button" onClick={handleAddText}>
              Add text note
            </button>
            <span className="qtm-sheet-tools-hint">
              Placed above the cursor’s beat. Click any note to edit it; clear it to remove.
            </span>
          </div>
        )}
        {song && (
          <ScoreView
            song={song}
            cursor={cursor}
            playhead={playhead}
            snap={snap}
            onHit={handleHit}
            onScrub={scrubTo}
            onAnnotationEdit={C.editAnnotationText}
            onAnnotationCommit={handleAnnotationCommit}
            autoFocusAnnotation={autoFocusAnnotation}
          />
        )}
        <div className="qtm-aids">
          <InstrumentPanel scale={scaleOverlay} />
          {song && (
            <TheoryPanel
              songKey={song.key}
              onChangeKey={handleChangeKey}
              showScale={showScale}
              onToggleScale={setShowScale}
              selectedChord={selectedChord}
              onSelectChord={setSelectedChord}
            />
          )}
        </div>
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
