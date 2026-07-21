/**
 * Per-track level, pan, mute and solo.
 *
 * Mixer settings live in the document rather than in playback state: they are
 * part of how the song is meant to sound, they belong in the `.qtm` file, and
 * a user who mutes the guitar to learn the bass line expects that to survive a
 * reload. The engine is told about a change immediately so it takes effect
 * mid-playback instead of on the next press of play.
 */

import { useEffect } from 'react';
import { isAudible } from '../audio/schedule';
import * as C from '../editor/commands';
import { useSongStore } from '../store/songStore';
import { usePlaybackStore } from '../store/playbackStore';
import './mixer.css';

export function Mixer() {
  const song = useSongStore((s) => s.song);
  const syncMixers = usePlaybackStore((s) => s.syncMixers);

  // The document is the source of truth, so the engine follows it rather than
  // each control pushing its own update — that way undo moves the faders too.
  useEffect(() => {
    syncMixers();
  }, [song, syncMixers]);

  if (!song) return null;

  return (
    <section className="qtm-mixer" aria-label="Mixer">
      {song.tracks.map((track) => {
        // Shares the engine's own rule, so a strip dimmed on screen is exactly
        // a strip that is inaudible.
        const silenced = !isAudible(song.tracks, track);
        return (
          <div
            key={track.id}
            className={`qtm-strip${silenced ? ' qtm-strip--silent' : ''}`}
          >
            <span className="qtm-strip-name">{track.name}</span>
            <input
              className="qtm-strip-fader"
              type="range"
              min={0}
              max={100}
              value={Math.round(track.mixer.volume * 100)}
              aria-label={`${track.name} volume`}
              onChange={(e) => C.setMixer(track.id, { volume: Number(e.target.value) / 100 })}
            />
            <div className="qtm-strip-buttons">
              <button
                type="button"
                className={`qtm-tiny${track.mixer.muted ? ' qtm-tiny--on' : ''}`}
                aria-pressed={track.mixer.muted}
                onClick={() => C.setMixer(track.id, { muted: !track.mixer.muted })}
              >
                M
              </button>
              <button
                type="button"
                className={`qtm-tiny${track.mixer.solo ? ' qtm-tiny--solo' : ''}`}
                aria-pressed={track.mixer.solo}
                onClick={() => C.setMixer(track.id, { solo: !track.mixer.solo })}
              >
                S
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
