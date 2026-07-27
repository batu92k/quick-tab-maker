/**
 * Transport bar: play, stop, tempo, metronome, count-in and loop.
 *
 * Everything here is a thin control over `playbackStore`. The one piece of real
 * logic is tap tempo, which is local because a half-finished tap sequence is
 * not application state — abandoning it should cost nothing and leave no trace.
 */

import { useCallback, useRef, useState } from 'react';
import * as C from '../editor/commands';
import { songLengthInBars } from '../model/song';
import { useSongStore } from '../store/songStore';
import { usePlaybackStore } from '../store/playbackStore';
import './transport.css';

/** Taps older than this belong to a previous attempt, not this one. */
const TAP_TIMEOUT_MS = 2500;
/** Intervals averaged. Four taps is one bar of 4/4 — the natural unit to tap. */
const TAP_WINDOW = 4;

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function Transport() {
  const song = useSongStore((s) => s.song);
  const status = usePlaybackStore((s) => s.status);
  const position = usePlaybackStore((s) => s.position);
  const positionSeconds = usePlaybackStore((s) => s.positionSeconds);
  const metronome = usePlaybackStore((s) => s.metronome);
  const countInBars = usePlaybackStore((s) => s.countInBars);
  const loop = usePlaybackStore((s) => s.loop);
  const error = usePlaybackStore((s) => s.error);

  const taps = useRef<number[]>([]);
  const [tapHint, setTapHint] = useState<string | null>(null);

  const handleTap = useCallback(() => {
    const now = performance.now();
    const recent = taps.current.filter((t) => now - t < TAP_TIMEOUT_MS);
    recent.push(now);
    taps.current = recent.slice(-(TAP_WINDOW + 1));

    if (taps.current.length < 2) {
      setTapHint('Keep tapping…');
      return;
    }
    const intervals = taps.current.slice(1).map((t, i) => t - taps.current[i]!);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / mean);
    setTapHint(`${bpm} BPM`);
    C.setTempo(bpm);
  }, []);

  if (!song) return null;

  const bars = songLengthInBars(song);
  const bpm = song.tempoMap[0]?.bpm ?? 120;
  const counting = status === 'playing' && positionSeconds < 0;

  return (
    <section className="qtm-transport" aria-label="Transport">
      <div className="qtm-transport-group">
        <button
          type="button"
          className="qtm-button qtm-button--primary qtm-transport-icon"
          aria-label={status === 'playing' ? 'Pause' : 'Play'}
          onClick={() => void usePlaybackStore.getState().toggle()}
        >
          {status === 'playing' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M4 3l9 5-9 5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="qtm-button qtm-transport-icon"
          aria-label="Stop"
          onClick={() => usePlaybackStore.getState().stop()}
          disabled={status === 'stopped'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="4" y="4" width="8" height="8" fill="currentColor" />
          </svg>
        </button>
      </div>

      <output className="qtm-transport-readout" aria-live="off">
        {counting ? (
          <span className="qtm-transport-counting">Count-in…</span>
        ) : (
          <>
            <strong>Bar {(position?.bar ?? 0) + 1}</strong>
            <span className="qtm-transport-time">{formatTime(positionSeconds)}</span>
          </>
        )}
      </output>

      <div className="qtm-transport-group">
        <label className="qtm-field">
          <span>Tempo</span>
          <input
            type="number"
            min={20}
            max={400}
            value={bpm}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) C.setTempo(next);
            }}
          />
        </label>
        <button type="button" className="qtm-button" onClick={handleTap}>
          Tap
        </button>
        {tapHint && <span className="qtm-transport-hint">{tapHint}</span>}
      </div>

      <div className="qtm-transport-group">
        <button
          type="button"
          className="qtm-button qtm-transport-icon"
          aria-label="Metronome"
          aria-pressed={metronome}
          onClick={() => usePlaybackStore.getState().setMetronome(!metronome)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M6 2.5h4l2.2 11H3.8z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <line
              x1="8"
              y1="11.5"
              x2="10.4"
              y2="4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <label className="qtm-field">
          <span>Count-in</span>
          <select
            value={countInBars}
            onChange={(e) => usePlaybackStore.getState().setCountInBars(Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </select>
        </label>
      </div>

      <div className="qtm-transport-group">
        <label className="qtm-check">
          <input
            type="checkbox"
            checked={loop !== null}
            onChange={(e) =>
              usePlaybackStore
                .getState()
                .setLoop(e.target.checked ? { startBar: 0, endBar: Math.min(4, bars) } : null)
            }
          />
          <span>Loop</span>
        </label>
        {loop && (
          <>
            <label className="qtm-field">
              <span>from</span>
              <input
                type="number"
                min={1}
                max={bars}
                value={loop.startBar + 1}
                onChange={(e) =>
                  usePlaybackStore.getState().setLoop({
                    ...loop,
                    startBar: Math.max(0, Number(e.target.value) - 1),
                  })
                }
              />
            </label>
            <label className="qtm-field">
              <span>to</span>
              <input
                type="number"
                min={1}
                max={bars}
                // Displayed inclusively — "bars 1 to 4" is how a musician says
                // it — while the region stays half-open internally.
                value={loop.endBar}
                onChange={(e) =>
                  usePlaybackStore.getState().setLoop({
                    ...loop,
                    endBar: Math.min(bars, Math.max(1, Number(e.target.value))),
                  })
                }
              />
            </label>
          </>
        )}
      </div>

      {error && <span className="qtm-transport-error">{error}</span>}
    </section>
  );
}
