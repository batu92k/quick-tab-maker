/**
 * Note-entry toolbar: duration, modifiers, structure and history.
 *
 * Everything here is also a keyboard shortcut. The buttons exist for
 * discoverability and for pointer-only use; the shortcut is shown in each
 * tooltip so the toolbar teaches the keyboard rather than competing with it.
 */

import * as F from '../model/fraction';
import { isStringTrack } from '../model/types';
import { useSongStore } from '../store/songStore';
import { usePlaybackStore } from '../store/playbackStore';
import * as C from './commands';
import {
  TOOLBAR_DURATIONS,
  compose,
  decompose,
  durationLabel,
  durationShortLabel,
} from './durations';
import { SNAP_OPTIONS, snapIndex } from './snap';
import './toolbar.css';

const TECHNIQUES = [
  { technique: 'hammer', label: 'H', title: 'Hammer-on (H)' },
  { technique: 'pull', label: 'P', title: 'Pull-off (P)' },
  { technique: 'slide', label: '/', title: 'Slide (S)' },
  { technique: 'bend', label: 'b', title: 'Bend (B)' },
  { technique: 'vibrato', label: '~', title: 'Vibrato (V)' },
  { technique: 'palmMute', label: 'PM', title: 'Palm mute (M)' },
  { technique: 'ghost', label: 'x', title: 'Ghost note (G)' },
] as const;

export function EditorToolbar() {
  const entryDuration = useSongStore((s) => s.entryDuration);
  const canUndo = useSongStore((s) => s.past.length > 0);
  const canRedo = useSongStore((s) => s.future.length > 0);
  const undo = useSongStore((s) => s.undo);
  const redo = useSongStore((s) => s.redo);
  const cursor = useSongStore((s) => s.cursor);
  const song = useSongStore((s) => s.song);
  const snap = usePlaybackStore((s) => s.snap);

  const track = song?.tracks.find((t) => t.id === cursor?.trackId);
  const isFretted = track ? isStringTrack(track) : false;
  const parts = decompose(entryDuration);

  // Derived from subscribed state rather than read from the store imperatively,
  // so the button's enabled state tracks the cursor as it moves.
  const beatUnderCursor =
    track && cursor ? track.measures[cursor.measureIndex]?.beats[cursor.beatIndex] : undefined;
  const canApply = Boolean(beatUnderCursor && beatUnderCursor.notes.length > 0);

  return (
    <div className="qtm-toolbar" role="toolbar" aria-label="Note entry">
      <div className="qtm-toolbar-group" role="group" aria-label="Note value">
        {TOOLBAR_DURATIONS.map((duration) => {
          const active = F.eq(decompose(entryDuration).base, duration);
          return (
            <button
              key={F.toString(duration)}
              type="button"
              className={`qtm-tool${active ? ' qtm-tool--active' : ''}`}
              title={durationLabel(duration)}
              aria-pressed={active}
              // Picking a note value keeps whatever dots and tuplet are armed,
              // so switching from a dotted eighth to a dotted quarter is one
              // click rather than three.
              onClick={() =>
                C.setEntryDuration(
                  compose(
                    parts.tuplet
                      ? { base: duration, dots: parts.dots, tuplet: parts.tuplet }
                      : { base: duration, dots: parts.dots },
                  ),
                )
              }
            >
              {durationShortLabel(duration)}
            </button>
          );
        })}

        <button
          type="button"
          className={`qtm-tool${parts.dots > 0 ? ' qtm-tool--active' : ''}`}
          title="Cycle dotted (.)"
          aria-pressed={parts.dots > 0}
          onClick={C.cycleDots}
        >
          {parts.dots === 2 ? '··' : '·'}
        </button>
        <button
          type="button"
          className={`qtm-tool${parts.tuplet ? ' qtm-tool--active' : ''}`}
          title="Toggle triplet (T)"
          aria-pressed={Boolean(parts.tuplet)}
          onClick={C.toggleTriplet}
        >
          3
        </button>

        {/* Choosing a note value only arms it for the next note. Rewriting an
            existing note is deliberately a separate, explicit action. */}
        <button
          type="button"
          className="qtm-tool qtm-tool--wide"
          title="Apply this note value to the note under the cursor (A)"
          disabled={!canApply}
          onClick={() => C.applyDurationToCursorBeat()}
        >
          Apply to note
        </button>
      </div>

      {isFretted && (
        <div className="qtm-toolbar-group" role="group" aria-label="Techniques">
          {TECHNIQUES.map((t) => (
            <button
              key={t.technique}
              type="button"
              className="qtm-tool"
              title={t.title}
              onClick={() => C.toggleTechniqueAtCursor(t.technique)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="qtm-toolbar-group" role="group" aria-label="Bars">
        <button type="button" className="qtm-tool qtm-tool--wide" title="Insert bar (Ctrl + Enter)" onClick={C.insertMeasureAtCursor}>
          Insert bar
        </button>
        <button type="button" className="qtm-tool qtm-tool--wide" title="Add bar at end (Enter)" onClick={C.appendMeasure}>
          Add bar
        </button>
        <button
          type="button"
          className="qtm-tool qtm-tool--wide"
          title="Delete this track's bar (Ctrl + Backspace)"
          onClick={C.deleteMeasureAtCursor}
        >
          Delete bar
        </button>
        <button
          type="button"
          className="qtm-tool qtm-tool--wide"
          title="Empty the bar but keep it, so tracks stay aligned (Ctrl + Shift + Backspace)"
          onClick={C.clearMeasureAtCursor}
        >
          Clear bar
        </button>
      </div>

      <div className="qtm-toolbar-group qtm-toolbar-snap" role="group" aria-label="Snap grid">
        <label>
          <span className="qtm-toolbar-snap-label">Snap</span>
          <select
            className="qtm-toolbar-select"
            value={snapIndex(snap)}
            onChange={(e) => C.setSnap(SNAP_OPTIONS[Number(e.target.value)]!.value)}
          >
            {SNAP_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="qtm-toolbar-group" role="group" aria-label="History">
        <button type="button" className="qtm-tool qtm-tool--wide" title="Undo (Ctrl + Z)" disabled={!canUndo} onClick={undo}>
          Undo
        </button>
        <button type="button" className="qtm-tool qtm-tool--wide" title="Redo (Ctrl + Shift + Z)" disabled={!canRedo} onClick={redo}>
          Redo
        </button>
      </div>

      <div className="qtm-toolbar-status">
        <span className="qtm-toolbar-duration">{durationLabel(entryDuration)}</span>
        {track && <span className="qtm-toolbar-track">{track.name}</span>}
      </div>
    </div>
  );
}
