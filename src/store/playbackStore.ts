/**
 * Playback state: the transport, and the clock that drives the playhead.
 *
 * Kept separate from the song store because the two change at completely
 * different rates. The playhead moves sixty times a second; putting it in the
 * document store would re-run every editor selector on every frame.
 *
 * The engine is loaded lazily and never touched before the user asks for sound,
 * so a session that only ever edits never constructs an AudioContext — browsers
 * warn about that, and it is wasted memory besides.
 */

import { create } from 'zustand';
import type { Id } from '../model/types';
import { SilentEngine, type AudioEngine } from '../audio/engine';
import {
  buildPlan,
  effectiveMixer,
  isAudible,
  positionAtTime,
  songDuration,
  timeAtBar,
  type MusicalPosition,
} from '../audio/schedule';
import { useSongStore } from './songStore';

export type PlaybackStatus = 'stopped' | 'playing' | 'paused';

export interface LoopRegion {
  readonly startBar: number;
  /** Exclusive. */
  readonly endBar: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  /**
   * Seconds into the *song*, so it is negative for the length of a count-in.
   * The playhead is simply not drawn while it is negative, which is the whole
   * reason the count-in is expressed this way rather than as bar -1.
   */
  positionSeconds: number;
  /** Where the playhead is musically, or undefined during count-in / at the end. */
  position: MusicalPosition | undefined;

  metronome: boolean;
  countInBars: number;
  loop: LoopRegion | null;
  /** True once the audio context has been unlocked by a user gesture. */
  ready: boolean;
  error: string | null;

  play: () => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seekToBar: (bar: number) => void;

  setMetronome: (on: boolean) => void;
  setCountInBars: (bars: number) => void;
  setLoop: (loop: LoopRegion | null) => void;

  /** Previews a single note, e.g. when the fretboard is clicked. */
  audition: (midi: number, kind: 'pitched' | 'percussive', trackId: Id) => void;

  /** Re-sends mixer settings without interrupting playback. */
  syncMixers: () => void;
}

let engine: AudioEngine = new SilentEngine();
let engineLoaded = false;
let frame: number | null = null;

/**
 * Swaps in the real backend on first use.
 *
 * If Tone fails to load — an old browser, a blocked context — the silent engine
 * stays in place and the transport keeps working with no sound rather than the
 * play button doing nothing at all.
 */
async function ensureEngine(): Promise<AudioEngine> {
  if (!engineLoaded) {
    engineLoaded = true;
    try {
      const { createToneEngine } = await import('../audio/toneEngine');
      engine = await createToneEngine();
    } catch (error) {
      console.error('[audio] Falling back to silence', error);
      usePlaybackStore.setState({ error: 'Audio could not start in this browser.' });
    }
  }
  await engine.unlock();
  return engine;
}

/** Exposed so tests can install a stub instead of loading Tone. */
export function setEngineForTesting(next: AudioEngine): void {
  engine = next;
  engineLoaded = true;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => {
  /**
   * The playhead is read from the audio clock every frame rather than advanced
   * by a timer. A timer drifts against the audio hardware, and the drift is
   * exactly the thing a musician notices: the line stops sitting on the note
   * that is sounding.
   */
  function tick(): void {
    const song = useSongStore.getState().song;
    const plan = currentPlan();
    if (!song || !plan) return;

    const seconds = engine.position() - plan.songOffset;
    set({ positionSeconds: seconds, position: positionAtTime(song, seconds) });

    if (!plan.loop && seconds >= songDuration(song)) {
      get().stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function startTicking(): void {
    if (frame === null) frame = requestAnimationFrame(tick);
  }

  function stopTicking(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  let plan: ReturnType<typeof buildPlan> | null = null;
  const currentPlan = () => plan;

  return {
    status: 'stopped',
    positionSeconds: 0,
    position: undefined,
    metronome: false,
    countInBars: 0,
    loop: null,
    ready: false,
    error: null,

    async play() {
      const song = useSongStore.getState().song;
      if (!song) return;

      const active = await ensureEngine();
      set({ ready: active.unlocked });

      const { metronome, countInBars, loop, status, positionSeconds } = get();
      // Resuming from a pause keeps the count-in out of the way: it exists to
      // start a take, not to interrupt one.
      const resuming = status === 'paused' && positionSeconds > 0;
      plan = buildPlan(song, { countInBars: resuming ? 0 : countInBars, loop });

      await active.load(plan);
      active.setMetronomeEnabled(metronome);

      // Transport zero is the top of the count-in, so a fresh start is 0 and a
      // resume is the song position shifted by however long the count-in was.
      active.play(resuming ? positionSeconds + plan.songOffset : 0);
      set({ status: 'playing' });
      startTicking();
    },

    async toggle() {
      if (get().status === 'playing') get().pause();
      else await get().play();
    },

    pause() {
      engine.pause();
      stopTicking();
      set({ status: 'paused' });
    },

    stop() {
      engine.stop();
      stopTicking();
      set({ status: 'stopped', positionSeconds: 0, position: undefined });
    },

    seekToBar(bar) {
      const song = useSongStore.getState().song;
      if (!song) return;
      const seconds = timeAtBar(song, bar);
      engine.seek(seconds + (plan?.songOffset ?? 0));
      set({ positionSeconds: seconds, position: positionAtTime(song, seconds) });
    },

    setMetronome(on) {
      set({ metronome: on });
      // Takes effect immediately, mid-playback included: the clicks are always
      // scheduled and this is only their level.
      engine.setMetronomeEnabled(on);
    },

    setCountInBars(bars) {
      set({ countInBars: Math.max(0, Math.min(4, Math.round(bars))) });
    },

    /**
     * Loop bounds are transport properties set when the plan is loaded, so a
     * change during playback applies from the next press of play. Moving the
     * loop under a running transport can drop the playhead outside its own
     * region, which is worse than waiting.
     */
    setLoop(loop) {
      set({ loop });
    },

    audition(midi, kind, trackId) {
      const song = useSongStore.getState().song;
      const track = song?.tracks.find((t) => t.id === trackId);
      // A muted track auditioning anyway would be confusing in exactly the
      // situation mute exists for: isolating one part while editing another.
      if (!song || !track || !isAudible(song.tracks, track)) return;
      void ensureEngine().then((active) => {
        set({ ready: active.unlocked });
        active.audition(midi, kind, track.instrumentId);
      });
    },

    syncMixers() {
      const song = useSongStore.getState().song;
      if (!song) return;
      // Solo is a property of the whole mixer, not of one track, so it is
      // resolved here and the engine only ever sees a final gain.
      for (const track of song.tracks) {
        engine.setTrackMix(track.id, effectiveMixer(song.tracks, track));
      }
    },
  };
});

/** Exposed for tests, which need the transport back at rest between cases. */
export function resetPlaybackForTesting(): void {
  usePlaybackStore.setState({
    status: 'stopped',
    positionSeconds: 0,
    position: undefined,
    metronome: false,
    countInBars: 0,
    loop: null,
    ready: false,
    error: null,
  });
}
