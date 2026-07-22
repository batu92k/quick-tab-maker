/**
 * Naming the chord a set of notes spells.
 *
 * Wraps tonal's `Chord.detect`, which does the interval analysis, and adds the
 * two things it does not do the way a player reading a sheet wants:
 *
 *  - It spells a plain major triad as `CM`; on a chord sheet that is written
 *    `C`. Sevenths and everything else keep their symbol (`Cmaj7`, `Cm7`, `C7`).
 *
 *  - For an inversion it lists an augmented re-spelling *first* — `E G C` comes
 *    back as `['Em#5', 'CM/E']`, and the second one is the name a guitarist
 *    means. So the candidates are ranked rather than taken in order: a reading
 *    with a raised or lowered fifth is treated as a last resort, and a slash
 *    inversion is preferred over inventing an altered root.
 *
 * Everything still resolves to MIDI first, through the one resolver, so the
 * names agree with what the audio engine plays.
 */

import { Chord } from 'tonal';
import type { Note } from '../model/types';
import { midiToPitch, stringFretToMidi, type FretboardSpec } from './midi';

/**
 * Below this many distinct pitch classes there is nothing worth naming: a
 * single note is not a chord, and most bare dyads (a third, a sixth) are too
 * ambiguous to label without guessing. Fifths are the exception tonal handles
 * on its own — it returns a `5` power chord — so two notes are allowed through
 * and simply yield nothing when they do not spell one.
 */
const MIN_NOTES = 2;

const AUGMENTED = /(#5|aug)/;
const FLAT_FIVE = /b5/;

/**
 * How reluctant we are to use a given spelling. Lower is better.
 *
 * A raised fifth is almost always tonal reinterpreting an inversion as an
 * augmented chord, so it is pushed well down; a lowered fifth is penalised more
 * gently because a real ♭5 chord does occur. A slash costs a little, so a clean
 * root-position name wins over an equivalent inversion, but far less than an
 * altered fifth costs — an honest slash beats a wrong root. Length breaks
 * remaining ties toward the simpler symbol.
 */
function penalty(symbol: string): number {
  let p = symbol.length * 0.1;
  if (AUGMENTED.test(symbol)) p += 5;
  if (FLAT_FIVE.test(symbol)) p += 3;
  if (symbol.includes('/')) p += 1;
  return p;
}

/** `CM` -> `C`; every other quality is left as tonal spelled it. */
function prettify(token: string): string {
  const slash = token.indexOf('/');
  const chord = slash === -1 ? token : token.slice(0, slash);
  const bass = slash === -1 ? '' : token.slice(slash);
  return chord.replace(/^([A-G][#b]?)M$/, '$1') + bass;
}

/**
 * The name of the chord some MIDI notes spell, or null if they do not spell one
 * tonal recognises.
 *
 * Notes are ordered lowest first so an inversion can be named as a slash chord —
 * the bass note is what makes `C/E` different from `C`, and it is exactly what a
 * player needs to see to finger it. Octave doublings collapse to one pitch
 * class, keeping the lowest as the bass.
 */
export function chordNameForMidi(midis: readonly number[]): string | null {
  const ascending = [...midis].sort((a, b) => a - b);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const midi of ascending) {
    const name = midiToPitch(midi).replace(/\d+$/, '');
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  if (names.length < MIN_NOTES) return null;

  const detected = Chord.detect(names);
  if (detected.length === 0) return null;
  const best = detected.reduce((a, b) => (penalty(b) < penalty(a) ? b : a));
  return prettify(best);
}

/**
 * The chord a string-track beat spells, resolving each fret to a pitch first.
 *
 * Returns null for anything that is not a nameable chord, which the caller
 * draws as nothing — a sheet peppered with guesses over every two-note fragment
 * is worse than one that only labels what it is sure of.
 */
export function chordForStringBeat(spec: FretboardSpec, notes: readonly Note[]): string | null {
  if (notes.length < MIN_NOTES) return null;
  return chordNameForMidi(notes.map((n) => stringFretToMidi(spec, n.string, n.fret)));
}
