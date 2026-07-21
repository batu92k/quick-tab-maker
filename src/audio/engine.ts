/**
 * What the rest of the app is allowed to know about making sound.
 *
 * Tone.js sits behind this and nowhere else. The reason is not hypothetical
 * portability — it is that Tone owns a global transport and a global audio
 * context, and code that reaches for those directly ends up with playback state
 * living in two places that disagree. Everything above this line deals in
 * seconds and MIDI numbers; everything below deals in oscillators.
 *
 * All times are *transport* seconds, which include any count-in. Converting to
 * a position within the song is the caller's job — see `PlaybackPlan.songOffset`.
 */

import type { Id, MixerSettings } from '../model/types';
import type { PlaybackPlan } from './schedule';

export type EngineState = 'stopped' | 'playing' | 'paused';

export interface AudioEngine {
  /**
   * Resumes the audio context. Browsers require this to happen inside a user
   * gesture, so it is separate from `play` — the transport button calls it, and
   * calling it twice is harmless.
   */
  unlock(): Promise<void>;
  readonly unlocked: boolean;

  /** Replaces the scheduled material. Safe to call while stopped or playing. */
  load(plan: PlaybackPlan): Promise<void>;

  play(fromSeconds?: number): void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;

  /** Current transport position in seconds. Reads the audio clock, not a timer. */
  position(): number;
  readonly state: EngineState;

  setTrackMix(trackId: Id, mixer: MixerSettings): void;
  /** Master metronome level, so the click can be toggled without a reload. */
  setMetronomeEnabled(enabled: boolean): void;

  /** Plays a single note immediately — the fretboard and drum pad preview. */
  audition(midi: number, kind: 'pitched' | 'percussive', instrumentId: string): void;

  dispose(): void;
}

/**
 * An engine that makes no sound.
 *
 * Used under Node in tests and as the value before the real backend has loaded,
 * so callers never have to null-check an engine. Silence is a legitimate
 * outcome; a crash on a missing AudioContext is not.
 */
export class SilentEngine implements AudioEngine {
  unlocked = false;
  state: EngineState = 'stopped';
  private at = 0;

  async unlock(): Promise<void> {
    this.unlocked = true;
  }
  async load(): Promise<void> {}
  play(fromSeconds?: number): void {
    if (fromSeconds !== undefined) this.at = fromSeconds;
    this.state = 'playing';
  }
  pause(): void {
    this.state = 'paused';
  }
  stop(): void {
    this.state = 'stopped';
    this.at = 0;
  }
  seek(seconds: number): void {
    this.at = seconds;
  }
  position(): number {
    return this.at;
  }
  setTrackMix(): void {}
  setMetronomeEnabled(): void {}
  audition(): void {}
  dispose(): void {}
}
