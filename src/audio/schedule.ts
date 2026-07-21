/**
 * Turns a song into a flat list of timed events.
 *
 * This is a pure function of the document — no Tone.js, no audio context, no
 * clock. That is deliberate: timing is the part of playback that is hard to get
 * right and impossible to debug by ear, so it is computed somewhere it can be
 * checked against hand-worked numbers. The engine's only job is to play what
 * this produces at the times it says.
 *
 * Musical positions arrive as exact fractions and leave as seconds. Seconds are
 * floats by nature, but the conversion happens once per event from an exact bar
 * start, so nothing accumulates: a note in bar 300 is computed from bar 300's
 * start time, not from 299 additions.
 *
 * BPM is always quarter-note BPM, including in compound time. A 6/8 bar at 120
 * is three quarters long, i.e. 1.5s — which is what every DAW and metronome
 * does, and what a user setting "120" expects.
 */

import * as F from '../model/fraction';
import { songLengthInBars, tempoAt, timeSignatureAt } from '../model/song';
import {
  isStringTrack,
  type DrumNote,
  type Id,
  type MixerSettings,
  type Note,
  type Song,
  type Track,
} from '../model/types';
import { clampVelocity, DEFAULT_VELOCITY, DRUM_PIECE_TO_GM, specOf, stringFretToMidi } from '../theory/midi';

/* -------------------------------------------------------------------------- */
/* Time                                                                       */
/* -------------------------------------------------------------------------- */

/** Length of one bar in seconds, at that bar's tempo and signature. */
export function barSeconds(song: Song, bar: number): number {
  const sig = timeSignatureAt(song, bar);
  return F.toSeconds(F.measureDuration(sig.num, sig.den), tempoAt(song, bar));
}

/**
 * Start time of every bar, plus one entry for the end of the song.
 *
 * Returned as an array rather than computed per lookup because the playhead
 * asks for it sixty times a second, and because a tempo change means bar N's
 * start is not derivable from bar N's tempo alone.
 */
export function barTimes(song: Song): number[] {
  const bars = songLengthInBars(song);
  const times: number[] = [0];
  let t = 0;
  for (let bar = 0; bar < bars; bar++) {
    t += barSeconds(song, bar);
    times.push(t);
  }
  return times;
}

/** Total playing time of the song in seconds. */
export function songDuration(song: Song): number {
  const times = barTimes(song);
  return times[times.length - 1] ?? 0;
}

export interface MusicalPosition {
  readonly bar: number;
  /**
   * How far into the bar, in whole notes. A float, not a `Fraction`: it comes
   * from a clock reading, so it is genuinely continuous and lands between beats
   * most of the time. Only ever used to position the playhead.
   */
  readonly offset: number;
}

/** Where the playhead is at a given moment, or undefined past the end. */
export function positionAtTime(song: Song, seconds: number): MusicalPosition | undefined {
  if (seconds < 0) return undefined;
  const times = barTimes(song);

  for (let bar = 0; bar + 1 < times.length; bar++) {
    const end = times[bar + 1]!;
    if (seconds < end) {
      // Quarters elapsed into the bar, converted to whole notes.
      const quarters = ((seconds - times[bar]!) * tempoAt(song, bar)) / 60;
      return { bar, offset: quarters / 4 };
    }
  }
  return undefined;
}

/** Time at which a bar starts, for seeking and loop points. */
export function timeAtBar(song: Song, bar: number): number {
  const times = barTimes(song);
  const clamped = Math.min(Math.max(bar, 0), times.length - 1);
  return times[clamped] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export interface ScheduledNote {
  /** Seconds from the start of the song. */
  readonly time: number;
  /** Sounding length in seconds. */
  readonly duration: number;
  /** MIDI note number: a pitch, or a General MIDI drum selector. */
  readonly midi: number;
  /** MIDI velocity, 1-127. The engine normalises; this stays in document terms. */
  readonly velocity: number;
  readonly trackId: Id;
  readonly instrumentId: string;
  readonly kind: 'pitched' | 'percussive';
}

/** How much a technique shortens and softens a note. */
const ARTICULATION = {
  palmMute: { duration: 0.35, velocity: 0.75 },
  ghost: { duration: 0.25, velocity: 0.45 },
} as const;

/** Drum articulations that change how hard the piece is struck. */
const DRUM_DYNAMICS: Partial<Record<DrumNote['articulation'], number>> = {
  accent: 1.3,
  ghost: 0.45,
};

/**
 * Whether a track should be heard, given what else is soloed.
 *
 * Solo wins over everything: as soon as any track is soloed, the unsoloed ones
 * fall silent whether or not they are muted. A soloed *and* muted track stays
 * silent, which is what a mixer does and what a user who muted it expects.
 *
 * This resolves to a gain rather than to "leave it out of the schedule".
 * Dropping muted tracks from the event list would mean unmuting mid-playback
 * did nothing at all until the next press of play, and mute is the one control
 * a person reaches for *while* listening.
 */
export function isAudible(tracks: readonly Track[], track: Track): boolean {
  if (track.mixer.muted) return false;
  const anySolo = tracks.some((t) => t.mixer.solo && !t.mixer.muted);
  return !anySolo || track.mixer.solo;
}

/** The mixer settings the engine should apply, with solo folded into mute. */
export function effectiveMixer(tracks: readonly Track[], track: Track): MixerSettings {
  return { ...track.mixer, muted: !isAudible(tracks, track) };
}

/** Mutable while being built; the tie handling has to reach back and extend. */
type Building = { -readonly [K in keyof ScheduledNote]: ScheduledNote[K] };

/**
 * Every note in the song, as timed events, sorted by time.
 *
 * Ties are resolved here rather than in the engine: a tied note is one sound
 * held longer, not two sounds in a row, and the difference is audible on
 * anything with an attack — which is every instrument this app has.
 */
export function scheduleSong(song: Song): ScheduledNote[] {
  const times = barTimes(song);
  const out: Building[] = [];

  for (const track of song.tracks) {
    // The event still sounding on each string, so a tie can extend it.
    const held = new Map<number, Building>();

    track.measures.forEach((measure, bar) => {
      const barTime = times[bar] ?? 0;
      const bpm = tempoAt(song, bar);

      for (const beat of measure.beats) {
        const time = barTime + F.toSeconds(beat.start, bpm);
        const full = F.toSeconds(beat.duration, bpm);

        for (const note of beat.notes) {
          if (isStringTrack(track)) {
            const n = note as Note;
            const midi = stringFretToMidi(specOf(track), n.string, n.fret);

            const previous = held.get(n.string);
            if (n.techniques.includes('tie') && previous && previous.midi === midi) {
              // Hold the existing sound through this beat instead of re-striking.
              previous.duration = time + full - previous.time;
              continue;
            }

            let duration = full;
            let velocity = n.velocity ?? DEFAULT_VELOCITY;
            for (const key of ['palmMute', 'ghost'] as const) {
              if (n.techniques.includes(key)) {
                duration *= ARTICULATION[key].duration;
                velocity *= ARTICULATION[key].velocity;
              }
            }

            const event: Building = {
              time,
              duration,
              midi,
              velocity: clampVelocity(velocity),
              trackId: track.id,
              instrumentId: track.instrumentId,
              kind: 'pitched',
            };
            out.push(event);
            held.set(n.string, event);
          } else {
            const d = note as DrumNote;
            const gain = DRUM_DYNAMICS[d.articulation] ?? 1;
            out.push({
              time,
              duration: full,
              midi: DRUM_PIECE_TO_GM[d.piece],
              velocity: clampVelocity((d.velocity ?? DEFAULT_VELOCITY) * gain),
              trackId: track.id,
              instrumentId: track.instrumentId,
              kind: 'percussive',
            });
          }
        }
      }
    });
  }

  return out.sort((a, b) => a.time - b.time || a.midi - b.midi);
}

/* -------------------------------------------------------------------------- */
/* Metronome                                                                  */
/* -------------------------------------------------------------------------- */

export interface ClickEvent {
  readonly time: number;
  /** The downbeat, played higher and louder so the bar is findable by ear. */
  readonly accent: boolean;
}

/**
 * Clicks for a range of bars.
 *
 * One click per denominator unit — four in 4/4, six in 6/8. Counting compound
 * time in dotted beats is what an experienced player wants, but counting every
 * eighth is what makes a bar learnable, and this is a practice tool.
 */
export function metronomeClicks(song: Song, fromBar: number, toBar: number): ClickEvent[] {
  const times = barTimes(song);
  const clicks: ClickEvent[] = [];

  for (let bar = fromBar; bar < toBar; bar++) {
    const start = times[bar];
    if (start === undefined) break;
    const sig = timeSignatureAt(song, bar);
    const bpm = tempoAt(song, bar);
    const unit = F.frac(1, sig.den);
    for (let i = 0; i < sig.num; i++) {
      clicks.push({ time: start + F.toSeconds(F.scale(unit, i), bpm), accent: i === 0 });
    }
  }
  return clicks;
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlanTrack {
  readonly id: Id;
  readonly name: string;
  readonly instrumentId: string;
  readonly mixer: MixerSettings;
}

export interface PlaybackPlan {
  readonly events: readonly ScheduledNote[];
  /**
   * Metronome clicks for the whole song, always present.
   *
   * The metronome is switched with a gain rather than by scheduling or not
   * scheduling these — same reasoning as mute. Wanting the click on halfway
   * through a take is the normal case, not the exception, and a switch that
   * only works from a standing start is not really a switch.
   */
  readonly clicks: readonly ClickEvent[];
  /** Count-in clicks. Separate because they sound whatever the metronome does. */
  readonly countIn: readonly ClickEvent[];
  /** Total transport length, count-in included. */
  readonly duration: number;
  /**
   * Where the song starts on the transport clock. Non-zero only for a count-in,
   * which is why the engine deals purely in transport time and the UI subtracts
   * this to get a song position — during the count-in that position is negative,
   * and "negative" is exactly the state the playhead should not be drawn in.
   */
  readonly songOffset: number;
  /** Loop bounds in transport time, or null. Never includes the count-in. */
  readonly loop: { readonly start: number; readonly end: number } | null;
  readonly tracks: readonly PlanTrack[];
}

export interface PlanOptions {
  /** Bars of clicks before the song starts. */
  readonly countInBars?: number;
  /** Loop region in bars; `endBar` is exclusive. */
  readonly loop?: { readonly startBar: number; readonly endBar: number } | null;
}

/**
 * Assembles everything the engine needs for one playback session.
 *
 * The engine never sees a `Song`. It gets times, pitches and gains, which is
 * what keeps the Tone.js backend replaceable and what will let a future offline
 * renderer or MIDI exporter consume the identical plan.
 */
export function buildPlan(song: Song, options: PlanOptions = {}): PlaybackPlan {
  const countInBars = Math.max(0, Math.floor(options.countInBars ?? 0));
  // Every count-in bar is a copy of bar 0. The count-in exists to set up the
  // first bar, so counting it at any other bar's tempo would mislead.
  const countInSeconds = countInBars * barSeconds(song, 0);

  const shift = (t: number): number => t + countInSeconds;
  const events = scheduleSong(song).map((e) => ({ ...e, time: shift(e.time) }));

  const countIn: ClickEvent[] = [];
  const sig = timeSignatureAt(song, 0);
  const bpm = tempoAt(song, 0);
  const unit = F.frac(1, sig.den);
  for (let bar = 0; bar < countInBars; bar++) {
    for (let i = 0; i < sig.num; i++) {
      countIn.push({
        time: bar * barSeconds(song, 0) + F.toSeconds(F.scale(unit, i), bpm),
        accent: i === 0,
      });
    }
  }

  const clicks = metronomeClicks(song, 0, songLengthInBars(song)).map((click) => ({
    ...click,
    time: shift(click.time),
  }));

  const loop = options.loop
    ? {
        start: shift(timeAtBar(song, options.loop.startBar)),
        end: shift(timeAtBar(song, options.loop.endBar)),
      }
    : null;

  return {
    events,
    clicks,
    countIn,
    duration: shift(songDuration(song)),
    songOffset: countInSeconds,
    loop: loop && loop.end > loop.start ? loop : null,
    tracks: song.tracks.map((t) => ({
      id: t.id,
      name: t.name,
      instrumentId: t.instrumentId,
      mixer: effectiveMixer(song.tracks, t),
    })),
  };
}
