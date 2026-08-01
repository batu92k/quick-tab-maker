/**
 * The Tone.js backend.
 *
 * This is the only module in the app that imports Tone, and it does so
 * dynamically: importing Tone constructs an AudioContext as a side effect,
 * which throws under Node and would make every model test depend on a browser.
 * `createToneEngine()` is therefore async and is called once, from the browser,
 * after the user asks for sound.
 *
 * Times handed to Tone are plain numbers, which Tone reads as seconds. The
 * transport's own BPM is left alone: tempo has already been resolved into
 * seconds by the scheduler, and having two places that know the tempo is how
 * a tempo change ends up applied twice.
 */

import { midiToFrequency, GM_TO_DRUM_PIECE } from '../theory/midi';
import type { DrumPiece, Id, MixerSettings } from '../model/types';
import type { AudioEngine, EngineState } from './engine';
import type { PlaybackPlan } from './schedule';

type ToneModule = typeof import('tone');
type ToneNode = InstanceType<ToneModule['Gain']>;

/** MIDI velocity is 1-127; every Tone trigger takes 0-1. */
const normalise = (velocity: number): number => Math.min(1, Math.max(0, velocity / 127));

/* -------------------------------------------------------------------------- */
/* Voices                                                                     */
/* -------------------------------------------------------------------------- */

interface Voice {
  readonly output: ToneNode;
  trigger(midi: number, duration: number, time: number, velocity: number): void;
  dispose(): void;
}

/**
 * String-instrument voices are sampled.
 *
 * A `Tone.Sampler` holds a sparse set of recorded pitches — electric guitar and
 * electric bass, CC0/CC-BY (see `public/samples/CREDITS.txt`) — and pitch-shifts
 * to fill the gaps. The sampler is polyphonic on its own, so unlike the old
 * plucked string there is no round-robin pool to manage. Its buffers load over
 * the network on construction; `load()` awaits `Tone.loaded()` so the first
 * press of play is never silent.
 */

/** Recorded pitches per instrument, mapped to the files in `public/samples`. */
const GUITAR_SAMPLES: Record<string, string> = {
  E2: 'E2.mp3',
  A2: 'A2.mp3',
  'D#3': 'Ds3.mp3',
  A3: 'A3.mp3',
  'D#4': 'Ds4.mp3',
  A4: 'A4.mp3',
  'D#5': 'Ds5.mp3',
  A5: 'A5.mp3',
};

const BASS_SAMPLES: Record<string, string> = {
  E1: 'E1.mp3',
  'A#1': 'As1.mp3',
  E2: 'E2.mp3',
  'A#2': 'As2.mp3',
  E3: 'E3.mp3',
  'A#3': 'As3.mp3',
  E4: 'E4.mp3',
};

function makeSampler(Tone: ToneModule, bass: boolean): InstanceType<ToneModule['Sampler']> {
  return new Tone.Sampler({
    urls: bass ? BASS_SAMPLES : GUITAR_SAMPLES,
    baseUrl: `${import.meta.env.BASE_URL}samples/${bass ? 'bass-electric' : 'guitar-electric'}/`,
    release: 0.6,
  });
}

/**
 * A sampled string voice, clean or distorted.
 *
 * The clean tone runs the sampler straight to the output. The distortion tone
 * is the *same* recorded sound driven into a waveshaper (`Tone.Distortion`) and
 * then rolled off with a low-pass, which is what turns the fizz back into an
 * overdriven-amp tone rather than white noise. One shared distortion node per
 * voice, so a chord intermodulates the way a real amp does. The output gain is
 * pulled back on the distorted tone as makeup, so switching Clean↔Distortion is
 * not also a jump in volume. The drive/amount/cutoff values are ear-tuned
 * starting points — safe to nudge.
 */
function sampledVoice(Tone: ToneModule, bass: boolean, distorted: boolean): Voice {
  const output = new Tone.Gain(distorted ? (bass ? 0.6 : 0.5) : 1);
  const sampler = makeSampler(Tone, bass);
  const extra: { dispose(): void }[] = [];

  if (distorted) {
    const tone = new Tone.Filter({ type: 'lowpass', frequency: bass ? 2600 : 3200, Q: 0.6 }).connect(output);
    const shaper = new Tone.Distortion({ distortion: bass ? 0.4 : 0.75, oversample: '2x' }).connect(tone);
    const drive = new Tone.Gain(bass ? 1.5 : 2.4).connect(shaper);
    sampler.connect(drive);
    extra.push(tone, shaper, drive);
  } else {
    sampler.connect(output);
  }

  return {
    output,
    trigger(midi, duration, time, velocity) {
      // Feed the sampler a frequency, so we never depend on Tone's MIDI-name
      // parsing. Silent until its buffers load — see `Tone.loaded()` in `load`.
      sampler.triggerAttackRelease(midiToFrequency(midi), duration, time, normalise(velocity));
    },
    dispose() {
      sampler.dispose();
      for (const node of extra) node.dispose();
      output.dispose();
    },
  };
}

/** Fundamental used for each tom, so the kit is tuned rather than three thuds. */
const TOM_PITCH: Partial<Record<DrumPiece, number>> = {
  tom1: 220,
  tom2: 165,
  floorTom: 110,
};

function drumVoice(Tone: ToneModule): Voice {
  const output = new Tone.Gain(1);

  // Shared kit bus. Light compression glues the hits together, a gentle EQ tilt
  // adds low-end weight and top-end air, and a touch of algorithmic room lifts
  // the kit off the dry synth floor it used to sit on. Freeverb is synchronous,
  // so there is no impulse response to await before the first hit. Every voice
  // below routes into `bus` rather than straight to the output.
  const room = new Tone.Freeverb({ roomSize: 0.42, dampening: 3200 });
  room.wet.value = 0.11;
  room.connect(output);
  const eq = new Tone.EQ3({ low: 2, mid: -1.5, high: 2.5, lowFrequency: 180, highFrequency: 3200 }).connect(room);
  const bus = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.003, release: 0.12 }).connect(eq);

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.42, sustain: 0.01, release: 1.2 },
  }).connect(bus);

  // A high-passed noise tick layered on the kick — the beater attack that a pure
  // sine membrane lacks, which is what makes a kick cut through on small speakers.
  const kickClickFilter = new Tone.Filter({ type: 'highpass', frequency: 1400 }).connect(bus);
  const kickClick = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
  }).connect(kickClickFilter);

  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.01,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0.01, release: 0.4 },
  }).connect(bus);

  // Snare is filtered noise. A band-pass around 2kHz is what gives it the
  // crack; unfiltered white noise reads as a hi-hat.
  const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 1.1 }).connect(bus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.17, sustain: 0 },
  }).connect(snareFilter);

  // A short pitched body under the crack, so the snare reads as a struck drum
  // rather than a burst of noise.
  const snareTone = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
  }).connect(bus);

  // Hats and cymbals are each one monophonic metal voice, so a second hit cuts
  // the first off. On hi-hats that is correct — a closed hat really does choke
  // the open one. Two cymbals struck together will also cut, which is the known
  // cost of not spending six oscillators per cymbal.
  const hat = new Tone.MetalSynth({
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 6000,
    octaves: 1.5,
    envelope: { attack: 0.001, decay: 0.06, release: 0.02 },
  }).connect(bus);

  const cymbal = new Tone.MetalSynth({
    harmonicity: 5.1,
    modulationIndex: 40,
    resonance: 3500,
    octaves: 1.5,
    envelope: { attack: 0.001, decay: 1.4, release: 1.2 },
  }).connect(bus);

  return {
    output,
    trigger(midi, duration, time, velocity) {
      const piece = GM_TO_DRUM_PIECE[midi];
      const gain = normalise(velocity);
      if (!piece) return;

      switch (piece) {
        case 'kick':
          kick.triggerAttackRelease(55, 0.28, time, gain);
          kickClick.triggerAttackRelease(0.02, time, gain * 0.5);
          return;
        case 'snare':
          snare.triggerAttackRelease(0.18, time, gain);
          snareTone.triggerAttackRelease(180, 0.1, time, gain * 0.6);
          return;
        case 'sideStick':
          snare.triggerAttackRelease(0.04, time, gain * 0.7);
          return;
        case 'tom1':
        case 'tom2':
        case 'floorTom':
          tom.triggerAttackRelease(TOM_PITCH[piece] ?? 165, 0.3, time, gain);
          return;
        case 'hihat':
          hat.triggerAttackRelease(320, 0.05, time, gain);
          return;
        case 'hihatPedal':
          hat.triggerAttackRelease(300, 0.07, time, gain * 0.8);
          return;
        case 'hihatOpen':
          // An open hat rings until the next hit or the end of its beat,
          // whichever the score says — this is the one drum whose written
          // duration is genuinely audible.
          hat.triggerAttackRelease(320, Math.min(duration, 0.9), time, gain);
          return;
        default:
          cymbal.triggerAttackRelease(piece === 'ride' || piece === 'rideBell' ? 480 : 300, piece === 'ride' ? 0.6 : 1.6, time, gain);
          return;
      }
    },
    dispose() {
      for (const node of [
        kick,
        kickClick,
        kickClickFilter,
        tom,
        snare,
        snareFilter,
        snareTone,
        hat,
        cymbal,
        bus,
        eq,
        room,
        output,
      ]) {
        node.dispose();
      }
    },
  };
}

function createVoice(Tone: ToneModule, instrumentId: string): Voice {
  if (instrumentId === 'drum-synth') return drumVoice(Tone);
  // Tone lives in the id as `<family>-<tone>` (see `model/tones.ts`): the family
  // picks the sample set, the suffix picks clean vs. distorted.
  return sampledVoice(Tone, instrumentId.startsWith('bass'), instrumentId.endsWith('distortion'));
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

interface Channel {
  readonly instrumentId: string;
  readonly voice: Voice;
  readonly panner: InstanceType<ToneModule['Panner']>;
  readonly gain: ToneNode;
}

class ToneEngine implements AudioEngine {
  unlocked = false;
  state: EngineState = 'stopped';

  private readonly Tone: ToneModule;
  private readonly transport: ReturnType<ToneModule['getTransport']>;
  private readonly channels = new Map<Id, Channel>();
  // Typed by what we actually use. `Part` is generic in its value type, so a
  // heterogeneous array of them has no useful common instantiation.
  private readonly parts: { dispose(): void }[] = [];
  private readonly clickGain: ToneNode;
  private readonly click: InstanceType<ToneModule['MetalSynth']>;
  /**
   * The count-in has its own voice and its own gain.
   *
   * It sounds like the metronome but is not the metronome: switching the click
   * off must not also remove the count-in, which exists to start the take.
   * Sharing one synth would mean sharing one gain.
   */
  private readonly countInGain: ToneNode;
  private readonly countInClick: InstanceType<ToneModule['MetalSynth']>;
  private auditionChannel: Channel | null = null;

  constructor(Tone: ToneModule) {
    this.Tone = Tone;
    this.transport = Tone.getTransport();
    this.clickGain = new Tone.Gain(0).toDestination();
    this.click = ToneEngine.clickVoice(Tone).connect(this.clickGain);
    this.countInGain = new Tone.Gain(1).toDestination();
    this.countInClick = ToneEngine.clickVoice(Tone).connect(this.countInGain);
  }

  private static clickVoice(Tone: ToneModule): InstanceType<ToneModule['MetalSynth']> {
    return new Tone.MetalSynth({
      harmonicity: 12,
      modulationIndex: 20,
      resonance: 8000,
      octaves: 1,
      envelope: { attack: 0.001, decay: 0.04, release: 0.01 },
    });
  }

  async unlock(): Promise<void> {
    await this.Tone.start();
    this.unlocked = true;
  }

  async load(plan: PlaybackPlan): Promise<void> {
    this.clearParts();

    // Channels are keyed by track and rebuilt only when the instrument changes.
    // Rebuilding every load would allocate ten oscillators per track per press
    // of play, which is audible as a click and eventually as a stall.
    const wanted = new Set(plan.tracks.map((t) => t.id));
    for (const [id, channel] of this.channels) {
      const track = plan.tracks.find((t) => t.id === id);
      if (!track || track.instrumentId !== channel.instrumentId) {
        this.disposeChannel(channel);
        this.channels.delete(id);
      }
    }
    for (const [id] of this.channels) if (!wanted.has(id)) this.channels.delete(id);

    for (const track of plan.tracks) {
      if (!this.channels.has(track.id)) {
        this.channels.set(track.id, this.buildChannel(track.instrumentId));
      }
      this.setTrackMix(track.id, track.mixer);
    }

    // Sampled voices fetch their buffers on construction; wait for them so the
    // first press of play is not silent (resolves at once once they are cached).
    // A buffer that fails — offline, say — must not block the take: fall through
    // and let that one voice stay silent rather than refusing to play at all.
    try {
      await this.Tone.loaded();
    } catch {
      // proceed with whatever loaded
    }

    const notes = new this.Tone.Part<(typeof plan.events)[number]>((time, event) => {
      this.channels.get(event.trackId)?.voice.trigger(
        event.midi,
        event.duration,
        time,
        event.velocity,
      );
    }, plan.events as (typeof plan.events)[number][]).start(0);

    type Click = (typeof plan.clicks)[number];
    const strike = (voice: InstanceType<ToneModule['MetalSynth']>) => (time: number, event: Click) => {
      voice.triggerAttackRelease(event.accent ? 1600 : 1050, 0.02, time, event.accent ? 0.9 : 0.5);
    };
    const clicks = new this.Tone.Part<Click>(strike(this.click), plan.clicks as Click[]).start(0);
    const countIn = new this.Tone.Part<Click>(
      strike(this.countInClick),
      plan.countIn as Click[],
    ).start(0);

    this.parts.push(notes, clicks, countIn);

    if (plan.loop) {
      this.transport.loop = true;
      this.transport.loopStart = plan.loop.start;
      this.transport.loopEnd = plan.loop.end;
    } else {
      this.transport.loop = false;
    }
  }

  play(fromSeconds?: number): void {
    if (fromSeconds !== undefined) this.transport.seconds = fromSeconds;
    this.transport.start();
    this.state = 'playing';
  }

  pause(): void {
    this.transport.pause();
    this.state = 'paused';
  }

  stop(): void {
    this.transport.stop();
    this.transport.seconds = 0;
    this.state = 'stopped';
  }

  seek(seconds: number): void {
    this.transport.seconds = Math.max(0, seconds);
  }

  position(): number {
    return this.transport.seconds;
  }

  setTrackMix(trackId: Id, mixer: MixerSettings): void {
    const channel = this.channels.get(trackId);
    if (!channel) return;
    // Mute is applied here rather than by dropping the track from the plan, so
    // unmuting mid-playback takes effect on the next note instead of needing a
    // reload and a reseek.
    channel.gain.gain.value = mixer.muted ? 0 : mixer.volume;
    channel.panner.pan.value = mixer.pan;
  }

  setMetronomeEnabled(enabled: boolean): void {
    this.clickGain.gain.value = enabled ? 1 : 0;
  }

  audition(midi: number, kind: 'pitched' | 'percussive', instrumentId: string): void {
    if (!this.unlocked) return;
    if (this.auditionChannel?.instrumentId !== instrumentId) {
      if (this.auditionChannel) this.disposeChannel(this.auditionChannel);
      this.auditionChannel = this.buildChannel(instrumentId);
    }
    const channel = this.auditionChannel;
    const duration = kind === 'percussive' ? 0.3 : 0.9;
    // Trigger through `Tone.loaded()` so the first preview after switching to a
    // sampled instrument is not silent — its buffers may still be loading. When
    // they are already loaded (or the voice is synthesised) this resolves on the
    // next microtask, which is inaudible. `now()` rather than the transport
    // clock: an audition must sound whether or not the transport is running.
    void this.Tone.loaded()
      .then(() => {
        // A newer audition may have disposed or replaced this channel while its
        // buffers loaded; only fire if it is still the current one.
        if (this.auditionChannel === channel) {
          channel.voice.trigger(midi, duration, this.Tone.now(), 100);
        }
      })
      .catch(() => {});
  }

  dispose(): void {
    this.clearParts();
    for (const channel of this.channels.values()) this.disposeChannel(channel);
    this.channels.clear();
    if (this.auditionChannel) this.disposeChannel(this.auditionChannel);
    this.auditionChannel = null;
    for (const node of [this.click, this.clickGain, this.countInClick, this.countInGain]) {
      node.dispose();
    }
  }

  /* ---------------------------------------------------------------------- */

  private buildChannel(instrumentId: string): Channel {
    const gain = new this.Tone.Gain(0.8).toDestination();
    const panner = new this.Tone.Panner(0).connect(gain);
    const voice = createVoice(this.Tone, instrumentId);
    voice.output.connect(panner);
    return { instrumentId, voice, panner, gain };
  }

  private disposeChannel(channel: Channel): void {
    channel.voice.dispose();
    channel.panner.dispose();
    channel.gain.dispose();
  }

  private clearParts(): void {
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    this.transport.cancel();
  }
}

/** Builds the Tone backend. Call once, from the browser. */
export async function createToneEngine(): Promise<AudioEngine> {
  const Tone = await import('tone');
  return new ToneEngine(Tone);
}
