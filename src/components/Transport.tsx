/**
 * Transport bar: play, stop, tempo, metronome, count-in and loop.
 *
 * Everything here is a thin control over `playbackStore`. The one piece of real
 * logic is tap tempo, which is local because a half-finished tap sequence is
 * not application state — abandoning it should cost nothing and leave no trace.
 */

import { useCallback, useRef, useState } from 'react';
import * as C from '../editor/commands';
import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { songLengthInBars } from '../model/song';
import { useSongStore } from '../store/songStore';
import { usePlaybackStore } from '../store/playbackStore';
import './transport.css';

/** Snap grid choices, coarsest first. `null` is free positioning. */
const SNAP_OPTIONS: readonly { readonly label: string; readonly value: Fraction | null }[] = [
  { label: 'Off', value: null },
  { label: '1/4', value: F.QUARTER },
  { label: '1/8', value: F.EIGHTH },
  { label: '1/16', value: F.SIXTEENTH },
  { label: '1/32', value: F.THIRTY_SECOND },
];

function snapIndex(snap: Fraction | null): number {
  return SNAP_OPTIONS.findIndex((o) =>
    o.value === null ? snap === null : snap !== null && F.eq(o.value, snap),
  );
}

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
  const snap = usePlaybackStore((s) => s.snap);
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
          className="qtm-button qtm-button--primary"
          onClick={() => void usePlaybackStore.getState().toggle()}
        >
          {status === 'playing' ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="qtm-button"
          onClick={() => usePlaybackStore.getState().stop()}
          disabled={status === 'stopped'}
        >
          Stop
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
        <label className="qtm-check">
          <input
            type="checkbox"
            checked={metronome}
            onChange={(e) => usePlaybackStore.getState().setMetronome(e.target.checked)}
          />
          <span>Metronome</span>
        </label>
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
        <label className="qtm-field" title="Grid the playhead snaps to when you click the ruler">
          <span>Snap</span>
          <select
            value={snapIndex(snap)}
            onChange={(e) =>
              usePlaybackStore.getState().setSnap(SNAP_OPTIONS[Number(e.target.value)]!.value)
            }
          >
            {SNAP_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                {o.label}
              </option>
            ))}
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
