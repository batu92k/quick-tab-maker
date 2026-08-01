/**
 * Instrument tones.
 *
 * A string track's `instrumentId` (`types.ts`) doubles as its *tone* — the
 * sound a guitar or bass makes. The value is a `<family>-<tone>` string
 * (`guitar-clean`, `guitar-distortion`, `bass-clean`, `bass-distortion`) and is
 * the single key the audio engine (`audio/toneEngine.ts`) switches on to build a
 * voice. Encoding the tone in the id rather than a new field keeps the document
 * shape stable and means the playback plan and the audition path already carry
 * it — nothing new has to be threaded through.
 *
 * Drums have no selectable tone; a drum track keeps its `drum-synth` id.
 */

export type StringTone = 'guitar-clean' | 'guitar-distortion' | 'bass-clean' | 'bass-distortion';

export interface ToneDef {
  readonly id: StringTone;
  readonly kind: 'guitar' | 'bass';
  /** Short name shown in the picker, unique within a family. */
  readonly label: string;
  /** Whether the voice adds distortion. Read by the engine, not the UI. */
  readonly distorted: boolean;
}

const TONE_DEFS: readonly ToneDef[] = [
  { id: 'guitar-clean', kind: 'guitar', label: 'Clean', distorted: false },
  { id: 'guitar-distortion', kind: 'guitar', label: 'Distortion', distorted: true },
  { id: 'bass-clean', kind: 'bass', label: 'Clean', distorted: false },
  { id: 'bass-distortion', kind: 'bass', label: 'Distortion', distorted: true },
];

/** The tones a guitar or bass track can take, in picker order. */
export function tonesFor(kind: 'guitar' | 'bass'): readonly ToneDef[] {
  return TONE_DEFS.filter((t) => t.kind === kind);
}

/** The tone a freshly created track of this kind starts on. */
export function defaultToneFor(kind: 'guitar' | 'bass'): StringTone {
  return kind === 'bass' ? 'bass-clean' : 'guitar-clean';
}

/** Short label for a tone id; falls back to "Clean" for an unknown id. */
export function toneLabel(id: string): string {
  return TONE_DEFS.find((t) => t.id === id)?.label ?? 'Clean';
}

/** Whether the tone id names a distortion voice. Unknown ids read as clean. */
export function isDistorted(id: string): boolean {
  return TONE_DEFS.find((t) => t.id === id)?.distorted ?? false;
}
