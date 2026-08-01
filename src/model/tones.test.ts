import { describe, expect, it } from 'vitest';
import { defaultToneFor, isDistorted, toneLabel, tonesFor } from './tones';

describe('tones', () => {
  it('offers clean and distortion for each string instrument', () => {
    expect(tonesFor('guitar').map((t) => t.id)).toEqual(['guitar-clean', 'guitar-distortion']);
    expect(tonesFor('bass').map((t) => t.id)).toEqual(['bass-clean', 'bass-distortion']);
  });

  it('defaults a new track to its clean tone', () => {
    expect(defaultToneFor('guitar')).toBe('guitar-clean');
    expect(defaultToneFor('bass')).toBe('bass-clean');
  });

  it('labels a tone by its short name', () => {
    expect(toneLabel('guitar-distortion')).toBe('Distortion');
    expect(toneLabel('bass-clean')).toBe('Clean');
  });

  it('reports which tones are distorted', () => {
    expect(isDistorted('guitar-distortion')).toBe(true);
    expect(isDistorted('bass-distortion')).toBe(true);
    expect(isDistorted('guitar-clean')).toBe(false);
    // An unknown id (e.g. a stale drum id) reads as clean, never distorted.
    expect(isDistorted('drum-synth')).toBe(false);
  });
});
