/**
 * Demo content.
 *
 * `demoSong()` is the fixture the renderer, layout tests and the first-run
 * experience all share. It deliberately exercises the awkward cases — a chord,
 * a triplet, techniques, rests, and all three instruments at once — so that
 * rendering it correctly means the common cases are covered too.
 */

import { produce } from 'immer';
import * as E from './edit';
import * as F from './fraction';
import { createDrumTrack, createSong, createStringTrack } from './song';
import type { Song } from './types';

export function demoSong(): Song {
  const base = createSong({
    title: 'Demo Riff',
    artist: 'Quick Tab Maker',
    tempo: 110,
    key: { tonic: 'E', mode: 'minor' },
    tracks: [
      createStringTrack('guitar', { measureCount: 4 }),
      createStringTrack('bass', { measureCount: 4 }),
      createDrumTrack({ measureCount: 4 }),
    ],
  });

  return produce(base, (d) => {
    const guitar = d.tracks[0]!.id;
    const bass = d.tracks[1]!.id;
    const drums = d.tracks[2]!.id;
    const E8 = F.EIGHTH;
    const Q = F.QUARTER;
    const TRIPLET_8 = F.tuplet(F.EIGHTH, 3, 2);

    /* Guitar: an E minor pentatonic riff on the low strings. */
    const riff: [number, number][] = [
      [0, 0],
      [0, 3],
      [1, 0],
      [1, 2],
      [0, 0],
      [1, 2],
      [0, 3],
      [0, 0],
    ];
    riff.forEach(([string, fret], i) => {
      E.setNote(d, guitar, 0, i, string!, fret!, E8);
    });
    E.toggleTechnique(d, guitar, 0, 1, 0, 'hammer');
    E.toggleTechnique(d, guitar, 0, 4, 0, 'palmMute');

    // Bar 2: an Em chord, let ring, then a triplet run.
    for (const [string, fret] of [
      [0, 0],
      [1, 2],
      [2, 2],
      [3, 0],
      [4, 0],
      [5, 0],
    ]) {
      E.setNote(d, guitar, 1, 0, string!, fret!, F.HALF);
    }
    for (let i = 0; i < 6; i++) {
      E.setNote(d, guitar, 1, 1 + i, 2, [0, 2, 4, 5, 4, 2][i]!, TRIPLET_8);
    }

    // Bar 3: a rest, then a bend on the G string.
    E.setNote(d, guitar, 2, 1, 3, 7, Q);
    E.toggleTechnique(d, guitar, 2, 1, 3, 'bend');
    E.setNote(d, guitar, 2, 2, 3, 5, Q);
    E.toggleTechnique(d, guitar, 2, 2, 3, 'vibrato');

    /* Bass: roots under the guitar. */
    for (let bar = 0; bar < 3; bar++) {
      for (let i = 0; i < 4; i++) {
        E.setNote(d, bass, bar, i, 0, bar === 1 ? 3 : 0, Q);
      }
    }

    /* Drums: a straight backbeat with hats. */
    for (let bar = 0; bar < 3; bar++) {
      for (let i = 0; i < 8; i++) {
        E.toggleDrumNote(d, drums, bar, i, 'hihat', E8);
        if (i === 0 || i === 4) E.toggleDrumNote(d, drums, bar, i, 'kick', E8);
        if (i === 2 || i === 6) E.toggleDrumNote(d, drums, bar, i, 'snare', E8, 'accent');
      }
    }
    // A crash on the downbeat of the last full bar.
    E.toggleDrumNote(d, drums, 2, 0, 'crash', E8);
  });
}
