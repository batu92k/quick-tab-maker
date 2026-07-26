/**
 * Application shell.
 *
 * Phase 3 makes the score editable: click to place the cursor, type to enter
 * frets, and undo/redo. The transport and instrument panels arrive in later
 * phases and slot in around this same layout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as C from './editor/commands';
import { InstrumentDock } from './components/InstrumentDock';
import { InstrumentPanel } from './components/InstrumentPanel';
import { Mixer } from './components/Mixer';
import { TheoryPanel } from './components/TheoryPanel';
import { Transport } from './components/Transport';
import type { ScaleOverlay } from './components/Fretboard';
import { isStringTrack } from './model/types';
import { scaleInfo, type DiatonicChord } from './theory/scale';
import { EditorToolbar } from './editor/EditorToolbar';
import { Notice } from './editor/Notice';
import { NotationGuide } from './editor/NotationGuide';
import { ShortcutSheet } from './editor/ShortcutSheet';
import { useEditorKeyboard } from './editor/useEditorKeyboard';
import { SongLibrary } from './library/SongLibrary';
import { demoSong } from './model/fixtures';
import { ScoreView } from './render/ScoreView';
import { DEFAULT_LAYOUT_OPTIONS, type HitResult, type LayoutOptions } from './render/layout';
import { PdfExportDialog } from './settings/PdfExportDialog';
import { SettingsDrawer } from './settings/SettingsDrawer';
import { applyAppearance } from './settings/settings';
import { useSettingsStore } from './settings/settingsStore';
import { isAvailable, listSongs, loadSong, mostRecentSongId, saveSong } from './store/persistence';
import { usePlaybackStore } from './store/playbackStore';
import { useSongStore } from './store/songStore';
import './App.css';

type View = 'editor' | 'library';

function App() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const setCursor = useSongStore((s) => s.setCursor);
  const openSong = useSongStore((s) => s.openSong);
  const autosaveStatus = useSongStore((s) => s.autosaveStatus);
  const playhead = usePlaybackStore((s) => s.position);
  const snap = usePlaybackStore((s) => s.snap);
  const scrubTo = usePlaybackStore((s) => s.scrubTo);

  const settings = useSettingsStore();
  const [view, setView] = useState<View>('editor');
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedChord, setSelectedChord] = useState<DiatonicChord | null>(null);
  // Id of a note just added, so its input can grab focus for typing. Cleared on
  // blur so the same box is not re-focused on later renders.
  const [autoFocusAnnotation, setAutoFocusAnnotation] = useState<string | undefined>(undefined);

  // The editor's global key handler is silenced while the library is up, so its
  // inputs (rename fields, the file picker) are not read as fret entry.
  useEditorKeyboard(view === 'editor');

  useEffect(() => {
    // Open the most recently edited song on launch. On the very first run there
    // is nothing stored, so the demo is seeded as a starting point; if the
    // browser has no IndexedDB at all, the demo is opened unsaved so the editor
    // still works.
    let cancelled = false;
    void (async () => {
      if (useSongStore.getState().song) return;
      try {
        if (!(await isAvailable())) {
          if (!cancelled) openSong(demoSong());
          return;
        }
        const summaries = await listSongs();
        if (summaries.length === 0) {
          const demo = demoSong();
          if (!cancelled) openSong(demo);
          await saveSong(demo);
        } else {
          const id = await mostRecentSongId();
          const recent = id ? await loadSong(id) : undefined;
          if (!cancelled && recent) openSong(recent);
        }
      } catch (error) {
        console.error('[app] Could not open a song on launch', error);
        if (!cancelled) openSong(demoSong());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openSong]);

  // Apply every appearance preference to the document root as CSS tokens. One
  // effect covers theme, accent and fonts because they all resolve to custom
  // properties the renderer already reads.
  useEffect(() => {
    applyAppearance(settings, document.documentElement);
  }, [settings]);

  // Dev-only: build the PDF and hand back a blob URL, so the export can be
  // inspected in a tab without writing to the user's Downloads folder. Stripped
  // from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __qtmPreviewPdf?: () => Promise<string> }).__qtmPreviewPdf =
      async () => {
        const { buildPdf } = await import('./export/pdf');
        const doc = await buildPdf(useSongStore.getState().song!, {
          paper: settings.paperSize,
          orientation: settings.pdfOrientation,
          barsPerLine: settings.pdfBarsPerLine,
          maxBarsPerSystem: settings.maxBarsPerSystem,
        });
        return doc.output('bloburl') as unknown as string;
      };
  }, [
    settings.paperSize,
    settings.pdfOrientation,
    settings.pdfBarsPerLine,
    settings.maxBarsPerSystem,
  ]);

  // Score layout options derived from the tab-size and bars-per-line settings.
  // The base metrics are scaled together so the whole staff zooms as one.
  const scoreOptions = useMemo<Partial<LayoutOptions>>(() => {
    const t = settings.tabScale;
    const scaled = (value: number) => Math.round(value * t);
    return {
      fontSize: scaled(DEFAULT_LAYOUT_OPTIONS.fontSize),
      lineSpacing: scaled(DEFAULT_LAYOUT_OPTIONS.lineSpacing),
      stemHeight: scaled(DEFAULT_LAYOUT_OPTIONS.stemHeight),
      beatBaseWidth: scaled(DEFAULT_LAYOUT_OPTIONS.beatBaseWidth),
      minMeasureWidth: scaled(DEFAULT_LAYOUT_OPTIONS.minMeasureWidth),
      measurePadding: scaled(DEFAULT_LAYOUT_OPTIONS.measurePadding),
      ...(settings.maxBarsPerSystem !== null
        ? { maxBarsPerSystem: settings.maxBarsPerSystem }
        : {}),
    };
  }, [settings.tabScale, settings.maxBarsPerSystem]);

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

  const handleExportPdf = useCallback(async () => {
    if (!song) return;
    setExporting(true);
    try {
      // The PDF stack (jspdf, svg2pdf, react-dom/server) is loaded only here, on
      // demand, so it never weighs down the editor's startup.
      const { exportSongToPdf } = await import('./export/pdf');
      await exportSongToPdf(song, {
        paper: settings.paperSize,
        orientation: settings.pdfOrientation,
        barsPerLine: settings.pdfBarsPerLine,
        maxBarsPerSystem: settings.maxBarsPerSystem,
      });
      setShowExport(false);
    } catch (error) {
      console.error('[pdf] export failed', error);
      useSongStore.getState().setNotice('PDF export failed — see the console for details.');
    } finally {
      setExporting(false);
    }
  }, [
    song,
    settings.paperSize,
    settings.pdfOrientation,
    settings.pdfBarsPerLine,
    settings.maxBarsPerSystem,
  ]);

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

  // The track the cursor is on drives what the sticky dock shows: a string
  // track gets the key/scale helper and fretboard, a drum track just the kit.
  const activeTrack = song?.tracks.find((t) => t.id === cursor?.trackId);
  const dockCollapsed = settings.instrumentDockCollapsed;
  const toggleDock = useCallback(() => {
    const s = useSettingsStore.getState();
    s.update({ instrumentDockCollapsed: !s.instrumentDockCollapsed });
  }, []);

  if (view === 'library') {
    return <SongLibrary currentSongId={song?.id ?? null} onClose={() => setView('editor')} />;
  }

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
          <button type="button" className="qtm-button" onClick={() => setView('library')}>
            ☰ Songs
          </button>
          <button
            type="button"
            className="qtm-button"
            onClick={() => setShowExport(true)}
            disabled={!song}
          >
            Export PDF
          </button>
          <button type="button" className="qtm-button" onClick={() => setShowShortcuts(true)}>
            Shortcuts
          </button>
          <button type="button" className="qtm-button" onClick={() => setShowGuide(true)}>
            Notation key
          </button>
          <button type="button" className="qtm-button" onClick={() => setShowSettings(true)}>
            ⚙ Settings
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
            options={scoreOptions}
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
        <p className="qtm-hint">
          Click a position, then type a fret number. Arrow keys move, <kbd>[</kbd> and{' '}
          <kbd>]</kbd> change the note value, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.
        </p>
      </main>

      {song && activeTrack && (
        <InstrumentDock
          trackName={activeTrack.name}
          collapsed={dockCollapsed}
          onToggle={toggleDock}
        >
          {isStringTrack(activeTrack) && (
            <TheoryPanel
              songKey={song.key}
              onChangeKey={handleChangeKey}
              showScale={showScale}
              onToggleScale={setShowScale}
              selectedChord={selectedChord}
              onSelectChord={setSelectedChord}
            />
          )}
          <InstrumentPanel scale={scaleOverlay} />
        </InstrumentDock>
      )}

      <Notice />

      {showExport && (
        <PdfExportDialog
          onClose={() => setShowExport(false)}
          onExport={handleExportPdf}
          exporting={exporting}
        />
      )}
      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
      {showGuide && <NotationGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}

export default App;
