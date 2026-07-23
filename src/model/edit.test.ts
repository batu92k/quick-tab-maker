import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import * as E from './edit';
import * as F from './fraction';
import {
  createDrumTrack,
  createSong,
  createStringTrack,
  measureFilled,
  snapPositionInMeasure,
} from './song';
import { isStringTrack, type Measure, type Note, type Song, type StringTrack } from './types';

/** Applies a draft mutation, mirroring how the store calls these operations. */
function apply(song: Song, fn: (draft: Parameters<typeof E.setTitle>[0]) => void): Song {
  return produce(song, fn);
}

function guitarSong(): Song {
  return createSong({ tracks: [createStringTrack('guitar', { measureCount: 4 })] });
}

function drumSong(): Song {
  return createSong({ tracks: [createDrumTrack({ measureCount: 4 })] });
}

const trackOf = (song: Song): StringTrack => {
  const t = song.tracks[0]!;
  if (!isStringTrack(t)) throw new Error('expected a string track');
  return t;
};
const measureOf = (song: Song, i = 0): Measure<Note> => trackOf(song).measures[i]!;
const Q = F.QUARTER;

describe('setNote', () => {
  it('places a fret on a string', () => {
    const song = apply(guitarSong(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 0, 0, 3, Q);
    });
    const beat = measureOf(song).beats[0]!;
    expect(beat.notes).toHaveLength(1);
    expect(beat.notes[0]).toMatchObject({ string: 0, fret: 3 });
    expect(beat.duration).toEqual(Q);
    expect(beat.start).toEqual(F.ZERO);
  });

  it('pads with rests when writing past the current end of the bar', () => {
    const song = apply(guitarSong(), (d) => {
      E.setNote(d, d.tracks[0]!.id, 0, 2, 0, 5, Q);
    });
    const beats = measureOf(song).beats;
    expect(beats).toHaveLength(3);
    expect(beats[0]!.notes).toEqual([]); // rest
    expect(beats[1]!.notes).toEqual([]); // rest
    expect(beats[2]!.notes[0]).toMatchObject({ fret: 5 });
    // Rests are still positioned back-to-back.
    expect(beats.map((b) => F.toString(b.start))).toEqual(['0', '1/4', '1/2']);
  });

  it('builds a chord from notes on different strings', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 2, 2, Q);
      E.setNote(d, id, 0, 0, 0, 0, Q);
      E.setNote(d, id, 0, 0, 1, 2, Q);
    });
    const notes = measureOf(song).beats[0]!.notes;
    expect(notes).toHaveLength(1 + 2);
    expect(notes.map((n) => n.string)).toEqual([0, 1, 2]); // sorted low to high
  });

  it('replaces the note on a string rather than stacking a second one', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 3, Q);
      E.setNote(d, id, 0, 0, 0, 7, Q);
    });
    const notes = measureOf(song).beats[0]!.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.fret).toBe(7);
  });

  it('keeps techniques when a fret is corrected', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 3, Q);
      E.toggleTechnique(d, id, 0, 0, 0, 'palmMute');
      E.setNote(d, id, 0, 0, 0, 5, Q);
    });
    const note = measureOf(song).beats[0]!.notes[0]!;
    expect(note.fret).toBe(5);
    expect(note.techniques).toEqual(['palmMute']);
  });

  it('refuses out-of-range strings and frets, leaving the song untouched', () => {
    const before = guitarSong();
    const after = apply(before, (d) => {
      const id = d.tracks[0]!.id;
      expect(E.setNote(d, id, 0, 0, 99, 3, Q)).toBe(false);
      expect(E.setNote(d, id, 0, 0, 0, -1, Q)).toBe(false);
      expect(E.setNote(d, id, 0, 0, 0, 999, Q)).toBe(false);
    });
    expect(after).toBe(before); // immer returns the original when nothing changed
  });

  it('refuses to overflow the bar', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      // A 4/4 bar holds exactly four quarters, at beat indices 0-3.
      for (let i = 0; i < 4; i++) expect(E.setNote(d, id, 0, i, 0, i, Q)).toBe(true);
      expect(E.setNote(d, id, 0, 4, 0, 5, Q)).toBe(false);
    });
    expect(measureOf(song).beats).toHaveLength(4);
    expect(measureFilled(measureOf(song))).toEqual(F.WHOLE);
  });
});

describe('removeNote and clearBeat', () => {
  it('removes a note and trims the resulting trailing rest', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 3, Q);
      expect(E.removeNote(d, id, 0, 0, 0)).toBe(true);
    });
    // The bar is empty again, not left holding a stray rest.
    expect(measureOf(song).beats).toEqual([]);
  });

  it('keeps interior rests but drops trailing ones', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 3, Q);
      E.setNote(d, id, 0, 2, 0, 5, Q);
      E.removeNote(d, id, 0, 2, 0); // remove the last note
    });
    // Beat 1 was an interior rest, but with beat 2 emptied everything after
    // the first note is trailing and gets trimmed.
    expect(measureOf(song).beats).toHaveLength(1);
  });

  it('reports failure when there is no note to remove', () => {
    const before = guitarSong();
    apply(before, (d) => {
      expect(E.removeNote(d, d.tracks[0]!.id, 0, 0, 0)).toBe(false);
      expect(E.clearBeat(d, d.tracks[0]!.id, 0, 0)).toBe(false);
    });
  });
});

describe('rhythm', () => {
  it('changes a duration and re-flows the following beats', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 1, Q);
      E.setNote(d, id, 0, 1, 0, 2, Q);
      E.setNote(d, id, 0, 2, 0, 3, Q);
      expect(E.setBeatDuration(d, id, 0, 0, F.HALF)).toBe(true);
    });
    const beats = measureOf(song).beats;
    expect(beats.map((b) => F.toString(b.start))).toEqual(['0', '1/2', '3/4']);
  });

  it('refuses a duration that would overflow the bar', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      for (let i = 0; i < 4; i++) E.setNote(d, id, 0, i, 0, i, Q);
      expect(E.setBeatDuration(d, id, 0, 0, F.HALF)).toBe(false);
    });
    expect(measureOf(song).beats[0]!.duration).toEqual(Q);
  });

  it('rejects zero and negative durations', () => {
    apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 1, Q);
      expect(E.setBeatDuration(d, id, 0, 0, F.ZERO)).toBe(false);
      expect(E.setBeatDuration(d, id, 0, 0, F.neg(Q))).toBe(false);
    });
  });

  it('inserts and deletes beats, keeping the bar contiguous', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 1, Q);
      E.setNote(d, id, 0, 1, 0, 2, Q);
      expect(E.insertBeat(d, id, 0, 1, Q)).toBe(true);
    });
    const beats = measureOf(song).beats;
    expect(beats).toHaveLength(3);
    expect(beats[1]!.notes).toEqual([]); // the inserted rest
    expect(beats[2]!.notes[0]!.fret).toBe(2);
    expect(beats.map((b) => F.toString(b.start))).toEqual(['0', '1/4', '1/2']);

    const deleted = apply(song, (d) => {
      expect(E.deleteBeat(d, d.tracks[0]!.id, 0, 0)).toBe(true);
    });
    expect(measureOf(deleted).beats).toHaveLength(2);
    expect(measureOf(deleted).beats[0]!.start).toEqual(F.ZERO);
  });

  it('fits a full bar of triplet eighths exactly', () => {
    const tripletEighth = F.tuplet(F.EIGHTH, 3, 2);
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      for (let i = 0; i < 12; i++) {
        expect(E.setNote(d, id, 0, i, 0, i % 5, tripletEighth)).toBe(true);
      }
      // The thirteenth must not fit.
      expect(E.setNote(d, id, 0, 12, 0, 1, tripletEighth)).toBe(false);
    });
    expect(measureFilled(measureOf(song))).toEqual(F.WHOLE);
  });
});

describe('drums', () => {
  it('toggles a piece on and off', () => {
    const id = drumSong().tracks[0]!.id;
    const withKick = apply(drumSong(), (d) => {
      E.toggleDrumNote(d, d.tracks[0]!.id, 0, 0, 'kick', Q);
    });
    expect(withKick.tracks[0]!.measures[0]!.beats[0]!.notes).toHaveLength(1);

    const toggledOff = apply(withKick, (d) => {
      E.toggleDrumNote(d, d.tracks[0]!.id, 0, 0, 'kick', Q);
    });
    expect(toggledOff.tracks[0]!.measures[0]!.beats).toEqual([]);
    expect(id).toBeDefined();
  });

  it('layers different pieces on the same beat', () => {
    const song = apply(drumSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.toggleDrumNote(d, id, 0, 0, 'kick', Q);
      E.toggleDrumNote(d, id, 0, 0, 'hihat', Q);
    });
    expect(song.tracks[0]!.measures[0]!.beats[0]!.notes).toHaveLength(2);
  });

  it('changes articulation instead of removing when it differs', () => {
    const song = apply(drumSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.toggleDrumNote(d, id, 0, 0, 'snare', Q, 'normal');
      E.toggleDrumNote(d, id, 0, 0, 'snare', Q, 'accent');
    });
    const notes = song.tracks[0]!.measures[0]!.beats[0]!.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ articulation: 'accent' });
  });
});

describe('measures', () => {
  it('inserts and deletes across every track so bars stay aligned', () => {
    const song = createSong({
      tracks: [createStringTrack('guitar', { measureCount: 4 }), createDrumTrack({ measureCount: 4 })],
    });
    const inserted = apply(song, (d) => E.insertMeasure(d, 1));
    expect(inserted.tracks.map((t) => t.measures.length)).toEqual([5, 5]);

    const deleted = apply(inserted, (d) => {
      E.deleteMeasure(d, 1);
    });
    expect(deleted.tracks.map((t) => t.measures.length)).toEqual([4, 4]);
  });

  it('refuses to delete the only measure', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 1 })] });
    apply(song, (d) => {
      expect(E.deleteMeasure(d, 0)).toBe(false);
    });
  });

  it('moves later tempo markers when a bar is inserted', () => {
    const song = apply(guitarSong(), (d) => {
      E.setTempo(d, 90, 2);
    });
    expect(song.tempoMap).toEqual([
      { bar: 0, bpm: 120 },
      { bar: 2, bpm: 90 },
    ]);

    const inserted = apply(song, (d) => E.insertMeasure(d, 1));
    expect(inserted.tempoMap).toEqual([
      { bar: 0, bpm: 120 },
      { bar: 3, bpm: 90 },
    ]);
  });
});

describe('song settings', () => {
  it('replaces rather than duplicates a marker at the same bar', () => {
    const song = apply(guitarSong(), (d) => {
      E.setTempo(d, 140);
      E.setTempo(d, 150);
    });
    expect(song.tempoMap).toEqual([{ bar: 0, bpm: 150 }]);
  });

  it('keeps markers sorted by bar', () => {
    const song = apply(guitarSong(), (d) => {
      E.setTempo(d, 90, 3);
      E.setTempo(d, 100, 1);
    });
    expect(song.tempoMap.map((m) => m.bar)).toEqual([0, 1, 3]);
  });

  it('rejects implausible tempos and time signatures', () => {
    apply(guitarSong(), (d) => {
      expect(E.setTempo(d, 0)).toBe(false);
      expect(E.setTempo(d, -5)).toBe(false);
      expect(E.setTempo(d, 10_000)).toBe(false);
      expect(E.setTimeSignature(d, { num: 0, den: 4 })).toBe(false);
      expect(E.setTimeSignature(d, { num: 4, den: 5 })).toBe(false);
      expect(E.setTimeSignature(d, { num: 7, den: 8 })).toBe(true);
    });
  });

  it('records an updated timestamp on edits', async () => {
    const before = guitarSong();
    await new Promise((r) => setTimeout(r, 2));
    const after = apply(before, (d) => E.setTitle(d, 'Riff'));
    expect(after.title).toBe('Riff');
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });
});

describe('tracks', () => {
  it('pads a newly added track to the song length', () => {
    const song = createSong({ tracks: [createStringTrack('guitar', { measureCount: 6 })] });
    const withDrums = apply(song, (d) => {
      E.addTrack(d, createDrumTrack({ measureCount: 2 }));
    });
    expect(withDrums.tracks.map((t) => t.measures.length)).toEqual([6, 6]);
  });

  it('refuses to remove the last track', () => {
    apply(guitarSong(), (d) => {
      expect(E.removeTrack(d, d.tracks[0]!.id)).toBe(false);
    });
  });

  it('drops notes stranded by a tuning with fewer strings', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 5, 3, Q); // high E string
      E.setNote(d, id, 0, 0, 0, 3, Q); // low E string
      // Retune to a 4-string bass tuning: strings 4 and 5 no longer exist.
      expect(E.setTuning(d, id, ['E1', 'A1', 'D2', 'G2'])).toBe(true);
    });
    const notes = measureOf(song).beats[0]!.notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.string).toBe(0);
    expect(trackOf(song).tuning).toHaveLength(4);
  });

  it('keeps every note when the tuning keeps its string count', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 5, 3, Q);
      E.setTuning(d, id, ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']); // drop D
    });
    expect(measureOf(song).beats[0]!.notes).toHaveLength(1);
  });

  it('validates the capo range', () => {
    apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      expect(E.setCapo(d, id, 3)).toBe(true);
      expect(E.setCapo(d, id, -1)).toBe(false);
      expect(E.setCapo(d, id, 99)).toBe(false);
      expect(E.setCapo(d, id, 1.5)).toBe(false);
    });
  });
});

describe('annotations', () => {
  const song4 = (): Song =>
    createSong({ tracks: [createStringTrack('guitar', { measureCount: 4 })] });

  it('adds text notes and keeps them ordered by bar', () => {
    const song = apply(song4(), (d) => {
      E.addAnnotation(d, { id: 'b', bar: 2, offset: F.ZERO, text: 'two' });
      E.addAnnotation(d, { id: 'a', bar: 0, offset: F.ZERO, text: 'zero' });
    });
    expect(song.annotations.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('edits and removes an existing note, and refuses a missing one', () => {
    const song = apply(song4(), (d) => {
      E.addAnnotation(d, { id: 'a', bar: 1, offset: F.ZERO, text: 'x' });
      expect(E.setAnnotationText(d, 'a', 'play x2')).toBe(true);
      expect(E.setAnnotationText(d, 'nope', 'y')).toBe(false);
      expect(E.removeAnnotation(d, 'nope')).toBe(false);
    });
    expect(song.annotations[0]!.text).toBe('play x2');
    const emptied = apply(song, (d) => {
      expect(E.removeAnnotation(d, 'a')).toBe(true);
    });
    expect(emptied.annotations).toHaveLength(0);
  });

  it('re-anchors a note and re-sorts', () => {
    const song = apply(song4(), (d) => {
      E.addAnnotation(d, { id: 'a', bar: 0, offset: F.ZERO, text: 'x' });
      E.addAnnotation(d, { id: 'b', bar: 1, offset: F.ZERO, text: 'y' });
      expect(E.moveAnnotation(d, 'a', 3, F.QUARTER)).toBe(true);
      expect(E.moveAnnotation(d, 'a', -1, F.ZERO)).toBe(false);
    });
    expect(song.annotations.map((a) => a.id)).toEqual(['b', 'a']);
    expect(song.annotations.find((a) => a.id === 'a')!.bar).toBe(3);
  });

  it('shifts notes forward when a bar is inserted before them', () => {
    const song = apply(song4(), (d) => {
      E.addAnnotation(d, { id: 'a', bar: 2, offset: F.ZERO, text: 'x' });
      E.insertMeasure(d, 1);
    });
    expect(song.annotations[0]!.bar).toBe(3);
  });

  it('drops a note on a deleted bar and pulls later ones back', () => {
    const song = apply(song4(), (d) => {
      E.addAnnotation(d, { id: 'gone', bar: 1, offset: F.ZERO, text: 'x' });
      E.addAnnotation(d, { id: 'kept', bar: 2, offset: F.ZERO, text: 'y' });
      E.deleteMeasure(d, 1);
    });
    expect(song.annotations.map((a) => a.id)).toEqual(['kept']);
    expect(song.annotations[0]!.bar).toBe(1);
  });
});

describe('insertNoteAt', () => {
  it('splits a quarter into two eighths — the full-bar between-notes case', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      for (let i = 0; i < 4; i++) E.setNote(d, id, 0, i, 0, i, Q); // full bar of quarters
      // Click at 1/8 (between quarter 1 and 2), add an 8th on fret 9.
      expect(E.insertNoteAt(d, id, 0, F.EIGHTH, 0, 9, F.EIGHTH)).toBe(true);
    });
    const beats = measureOf(song).beats;
    expect(beats.map((b) => F.toString(b.duration))).toEqual(['1/8', '1/8', '1/4', '1/4', '1/4']);
    expect(beats.map((b) => b.notes[0]?.fret)).toEqual([0, 9, 1, 2, 3]);
    expect(F.toString(measureFilled(measureOf(song)))).toBe('1'); // still exactly one bar
  });

  it('leaves an interior rest when the note is shorter than the room in the split beat', () => {
    const song = apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 5, Q);
      E.setNote(d, id, 0, 1, 0, 6, Q); // a second quarter so the rest is not trailing
      // A 16th at 1/8: quarter1 -> [0,1/8] note, 16th note, 16th rest, then quarter2.
      expect(E.insertNoteAt(d, id, 0, F.EIGHTH, 0, 7, F.SIXTEENTH)).toBe(true);
    });
    const beats = measureOf(song).beats;
    expect(beats.map((b) => F.toString(b.duration))).toEqual(['1/8', '1/16', '1/16', '1/4']);
    expect(beats.map((b) => b.notes.length)).toEqual([1, 1, 0, 1]);
  });

  it('refuses a position on an onset or past the last note', () => {
    apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      E.setNote(d, id, 0, 0, 0, 5, Q); // fills [0, 1/4]
      expect(E.insertNoteAt(d, id, 0, F.ZERO, 0, 7, F.EIGHTH)).toBe(false); // onset
      expect(E.insertNoteAt(d, id, 0, F.QUARTER, 0, 7, F.EIGHTH)).toBe(false); // empty tail
    });
  });

  it('refuses an empty measure — there is no beat to split, so the caller appends', () => {
    // The between-notes click path must never reach here on an empty bar: with
    // no beat covering the position, a split is impossible and the first note of
    // a bar belongs at its start. This is the model half of the bug where a bar
    // emptied by deleting every other one could take no new notes.
    apply(guitarSong(), (d) => {
      const id = d.tracks[0]!.id;
      expect(E.insertNoteAt(d, id, 0, F.EIGHTH, 0, 7, F.EIGHTH)).toBe(false);
      expect(d.tracks[0]!.measures[0]!.beats.length).toBe(0); // untouched
    });
  });
});

describe('snapPositionInMeasure', () => {
  const cap = F.WHOLE;

  it('snaps to the nearest subdivision line in open space', () => {
    expect(snapPositionInMeasure([], cap, F.EIGHTH, 0.13)).toEqual(F.EIGHTH);
    expect(snapPositionInMeasure([], cap, F.EIGHTH, 0.3)).toEqual(F.QUARTER);
  });

  it('snaps to a note onset when nearer than a grid line, even off the grid', () => {
    const trip = F.tuplet(F.EIGHTH, 3, 2); // 1/12, on no 1/8 line
    const snapped = snapPositionInMeasure([{ start: trip }], cap, F.EIGHTH, 1 / 12 + 0.005);
    expect(snapped).toEqual(trip);
  });

  it('snaps a click past the last line to the barline (the append point)', () => {
    expect(snapPositionInMeasure([], cap, F.QUARTER, 0.98)).toEqual(F.WHOLE);
  });
});
