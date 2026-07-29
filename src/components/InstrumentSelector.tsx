/**
 * Instrument selector bar.
 *
 * The strip below the instrument dock. It picks which instrument the editor
 * shows — the score renders one at a time — and mixes that instrument (volume,
 * mute, solo). Choosing from the dropdown moves the editing cursor onto that
 * track, which is what the single-instrument view keys off; Ctrl+Up/Down does
 * the same from the keyboard.
 *
 * Mixer settings live in the document, so the engine is told to follow the
 * document on every change (syncMixers) — the same reason the retired Mixer
 * did, kept here now that this bar owns the faders.
 */

import { useEffect, useState } from 'react';
import { isAudible } from '../audio/schedule';
import * as C from '../editor/commands';
import { isStringTrack } from '../model/types';
import { useSongStore } from '../store/songStore';
import { usePlaybackStore } from '../store/playbackStore';
import { InstrumentSettingsDialog } from './InstrumentSettingsDialog';
import './instrument-selector.css';

export function InstrumentSelector() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const syncMixers = usePlaybackStore((s) => s.syncMixers);
  const [showSettings, setShowSettings] = useState(false);

  // The document is the source of truth; the engine follows it so undo moves
  // the faders too and a change takes effect mid-playback.
  useEffect(() => {
    syncMixers();
  }, [song, syncMixers]);

  const activeTrack = song?.tracks.find((t) => t.id === cursor?.trackId);

  // A drum track has no tuning; don't leave the dialog open with stale data
  // if the cursor moves off a string track while it's showing.
  useEffect(() => {
    if (!activeTrack || !isStringTrack(activeTrack)) setShowSettings(false);
  }, [activeTrack]);

  if (!song) return null;

  return (
    <section className="qtm-selector" aria-label="Instrument selector">
      {activeTrack && (
        <>
          <label className="qtm-selector-pick">
            <span className="qtm-selector-label">Instrument</span>
            <select value={activeTrack.id} onChange={(e) => C.selectTrack(e.target.value)}>
              {song.tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {isStringTrack(activeTrack) && (
            <button
              type="button"
              className="qtm-selector-gear"
              aria-label={`${activeTrack.name} settings`}
              title="Instrument settings (tuning)"
              onClick={() => setShowSettings(true)}
            >
              ⚙
            </button>
          )}

          <div
            className={`qtm-selector-mix${
              isAudible(song.tracks, activeTrack) ? '' : ' qtm-selector-mix--silent'
            }`}
          >
            <input
              className="qtm-selector-fader"
              type="range"
              min={0}
              max={100}
              value={Math.round(activeTrack.mixer.volume * 100)}
              aria-label={`${activeTrack.name} volume`}
              onChange={(e) => C.setMixer(activeTrack.id, { volume: Number(e.target.value) / 100 })}
            />
            <button
              type="button"
              className={`qtm-selector-toggle${activeTrack.mixer.muted ? ' qtm-selector-toggle--on' : ''}`}
              aria-pressed={activeTrack.mixer.muted}
              aria-label="Mute"
              onClick={() => C.setMixer(activeTrack.id, { muted: !activeTrack.mixer.muted })}
            >
              M
            </button>
            <button
              type="button"
              className={`qtm-selector-toggle${activeTrack.mixer.solo ? ' qtm-selector-toggle--solo' : ''}`}
              aria-pressed={activeTrack.mixer.solo}
              aria-label="Solo"
              onClick={() => C.setMixer(activeTrack.id, { solo: !activeTrack.mixer.solo })}
            >
              S
            </button>
          </div>
        </>
      )}

      <div className="qtm-selector-manage">
        <select
          className="qtm-selector-add"
          value=""
          aria-label="Add instrument"
          onChange={(e) => {
            if (e.target.value) C.addInstrument(e.target.value as 'guitar' | 'bass' | 'drums');
          }}
        >
          <option value="">＋ Add instrument…</option>
          <option value="guitar">Guitar</option>
          <option value="bass">Bass</option>
          <option value="drums">Drums</option>
        </select>
        {activeTrack && (
          <button
            type="button"
            className="qtm-selector-remove"
            aria-label={`Remove ${activeTrack.name}`}
            onClick={() => C.removeInstrument(activeTrack.id)}
          >
            ✕
          </button>
        )}
      </div>

      {showSettings && activeTrack && isStringTrack(activeTrack) && (
        <InstrumentSettingsDialog track={activeTrack} onClose={() => setShowSettings(false)} />
      )}
    </section>
  );
}
