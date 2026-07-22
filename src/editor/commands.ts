/**
 * Editor commands.
 *
 * Every user gesture — a keystroke, a click on the fretboard, a drum pad, and
 * later a MIDI note — funnels through these functions rather than calling the
 * store directly. That keeps the "what happens when a note is entered" logic in
 * one place: advance the cursor, respect the entry duration, stay inside the
 * bar. Input devices only have to decide *what* was played, not what it means.
 */

import * as E from '../model/edit';
import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { newAnnotationId } from '../model/ids';
import { beatIndexAtStart, measureCapacity, measureFilled, timeSignatureAt } from '../model/song';
import {
  isDrumTrack,
  isStringTrack,
  type AnyNote,
  type Cursor,
  type DrumPiece,
  type Note,
  type Track,
} from '../model/types';
import { defaultPieceForRow, rowForPiece, DRUM_ROW_COUNT } from '../theory/drums';
import { midiToFretPositions, midiToPitch, specOf } from '../theory/midi';
import type { NoteInputEvent } from './input/events';
import { useSongStore, type EditorState } from '../store/songStore';
import * as D from './durations';

type Store = EditorState;

const store = (): Store => useSongStore.getState();

/**
 * Explains a refused note entry.
 *
 * A full bar is the overwhelmingly common reason, and the message says what to
 * do about it: the arithmetic is correct but invisible, so "eight eighths is
 * already a whole 4/4 bar" is not obvious while staring at the screen.
 */
function explainRefusedEntry(track: Track, measureIndex: number): void {
  const song = store().song;
  const measure = track.measures[measureIndex];
  if (!song || !measure) return;

  if (F.gte(measureFilled(measure), measureCapacity(song, track, measureIndex))) {
    const sig = timeSignatureAt(song, measureIndex);
    store().setNotice(
      `Bar ${measureIndex + 1} is full (${sig.num}/${sig.den}). Shorten a note, or press Enter to add a bar.`,
    );
  }
}

/** The track the cursor is on, if any. */
export function currentTrack(): Track | undefined {
  const { song, cursor } = store();
  if (!song || !cursor) return undefined;
  return song.tracks.find((t) => t.id === cursor.trackId);
}

/**
 * Converts a visual line back to a string index.
 *
 * The cursor's `line` is a visual row with 0 at the top, but the document
 * indexes strings from the lowest pitch. This is the same inversion the
 * renderer applies, and getting it wrong here would enter notes on the mirrored
 * string — so both directions live next to their own tests.
 */
export function stringForLine(track: Track, line: number): number {
  return isStringTrack(track) ? track.tuning.length - 1 - line : line;
}

export function lineForString(track: Track, stringIndex: number): number {
  return isStringTrack(track) ? track.tuning.length - 1 - stringIndex : stringIndex;
}

/** A note of a beat, located on the neck. */
export interface SoundingPosition {
  readonly string: number;
  readonly fret: number;
  /** True for the note the cursor itself is on, as opposed to the rest of a chord. */
  readonly onCursorString: boolean;
}

/**
 * The notes of a beat, as fretboard positions.
 *
 * Pure and store-free so the fretboard can mirror the score without the score
 * and the neck disagreeing about which string is which — that inversion is the
 * one thing in this area that is easy to get backwards.
 *
 * `cursorString` is null when the beat is being played rather than edited:
 * there is no "note under the cursor" to pick out of a chord that is sounding.
 *
 * Empty for a drum track: the kit shows its own beat through `activePieces`.
 */
export function positionsInBeat(
  track: Track,
  beat: { readonly notes: readonly AnyNote[] } | undefined,
  cursorString: number | null,
): SoundingPosition[] {
  if (!isStringTrack(track) || !beat) return [];

  return (beat.notes as readonly Note[])
    // Callers resolve these to pitches, and the resolver throws on a position
    // the instrument does not have. A note stranded past the end of the neck by
    // a retuning should quietly not be drawn, not take the panel down with it.
    .filter(
      (note) =>
        note.string >= 0 &&
        note.string < track.tuning.length &&
        note.fret >= 0 &&
        note.fret <= track.fretCount,
    )
    .map((note) => ({
      string: note.string,
      fret: note.fret,
      onCursorString: cursorString !== null && note.string === cursorString,
    }));
}

/** The notes at the editing cursor's beat. */
export function soundingPositions(track: Track, cursor: Cursor): SoundingPosition[] {
  return positionsInBeat(
    track,
    track.measures[cursor.measureIndex]?.beats[cursor.beatIndex],
    stringForLine(track, cursor.line),
  );
}

/* -------------------------------------------------------------------------- */
/* Note entry                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Writes a fret at the cursor.
 *
 * Returns false when the edit was refused — the bar is full, or the fret is out
 * of range — so the caller can avoid advancing the cursor past a note that was
 * never written.
 */
export function setFretAtCursor(fret: number): boolean {
  const { cursor, entryDuration } = store();
  const track = currentTrack();
  if (!cursor || !track || !isStringTrack(track)) return false;

  if (fret > track.fretCount) {
    store().setNotice(`Fret ${fret} is past the end of a ${track.fretCount}-fret neck.`);
    return false;
  }

  const stringIndex = stringForLine(track, cursor.line);

  // An insert cursor places a note *between* existing ones by splitting the beat
  // it lands in. Once a note sits at that position — the note this same cursor
  // just placed — retyping edits it instead of splitting again, which is also
  // what makes two-digit fret entry work: the second digit undoes the first and
  // re-runs here against a bar where the position is empty once more.
  if (cursor.insertAt !== undefined) {
    const position = cursor.insertAt;
    const measure = track.measures[cursor.measureIndex];
    const existing = measure ? beatIndexAtStart(measure, position) : -1;

    let applied = false;
    store().edit(`Fret ${fret}`, (draft) => {
      applied =
        existing >= 0
          ? E.setNote(draft, cursor.trackId, cursor.measureIndex, existing, stringIndex, fret, entryDuration)
          : E.insertNoteAt(draft, cursor.trackId, cursor.measureIndex, position, stringIndex, fret, entryDuration);
    });
    if (applied) {
      store().setNotice(null);
      // Point beatIndex at the note now at the insert position, for the panel,
      // but keep insertAt so a two-digit fret can undo and re-insert.
      const next = currentTrack();
      const at =
        next && isStringTrack(next) && next.measures[cursor.measureIndex]
          ? beatIndexAtStart(next.measures[cursor.measureIndex]!, position)
          : -1;
      if (at >= 0) store().setCursor({ ...cursor, beatIndex: at });
    } else {
      explainRefusedEntry(track, cursor.measureIndex);
    }
    return applied;
  }

  let applied = false;
  store().edit(`Fret ${fret}`, (draft) => {
    applied = E.setNote(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      stringIndex,
      fret,
      entryDuration,
    );
  });
  if (applied) store().setNotice(null);
  else explainRefusedEntry(track, cursor.measureIndex);
  return applied;
}

/** Toggles a drum piece at the cursor, defaulting to the cursor row's piece. */
export function toggleDrumAtCursor(piece?: DrumPiece): boolean {
  const { cursor, entryDuration } = store();
  const track = currentTrack();
  if (!cursor || !track || !isDrumTrack(track)) return false;

  const target = piece ?? defaultPieceForRow(cursor.line);
  if (!target) return false;

  let applied = false;
  store().edit(`Toggle ${target}`, (draft) => {
    applied = E.toggleDrumNote(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      target,
      entryDuration,
    );
  });
  if (applied) store().setNotice(null);
  else explainRefusedEntry(track, cursor.measureIndex);
  return applied;
}

/**
 * Applies an input event from any device at the cursor.
 *
 * This is the seam MIDI plugs into: a `pitch` event carries no string, so a
 * playable position is chosen here. Preference goes to a position on or near
 * the cursor's current string, falling back to the lowest fret available, which
 * keeps a played phrase in one area of the neck rather than scattering it.
 */
export function applyNoteInput(event: NoteInputEvent): boolean {
  const track = currentTrack();
  const cursor = store().cursor;
  if (!track || !cursor) return false;

  switch (event.kind) {
    case 'drum':
      return isDrumTrack(track) ? toggleDrumAtCursor(event.piece) : false;

    case 'fret': {
      if (!isStringTrack(track)) return false;
      // The event names a document string, but the cursor addresses a visual
      // line, so move the cursor to match before writing.
      store().setCursor({ ...cursor, line: lineForString(track, event.string) });
      return setFretAtCursor(event.fret);
    }

    case 'pitch': {
      if (!isStringTrack(track)) return false;
      const positions = midiToFretPositions(specOf(track), event.midi);
      if (positions.length === 0) {
        store().setNotice(
          `${midiToPitch(event.midi)} cannot be played on this instrument's range.`,
        );
        return false;
      }
      const preferredString = stringForLine(track, cursor.line);
      const chosen =
        positions.find((p) => p.string === preferredString) ??
        positions[0]!;
      store().setCursor({ ...cursor, line: lineForString(track, chosen.string) });
      return setFretAtCursor(chosen.fret);
    }
  }
}

/** Deletes the note under the cursor. */
export function deleteAtCursor(): boolean {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return false;

  let applied = false;
  if (isStringTrack(track)) {
    const stringIndex = stringForLine(track, cursor.line);
    store().edit('Delete note', (draft) => {
      applied = E.removeNote(
        draft,
        cursor.trackId,
        cursor.measureIndex,
        cursor.beatIndex,
        stringIndex,
      );
    });
  } else {
    const piece = defaultPieceForRow(cursor.line);
    const beat = track.measures[cursor.measureIndex]?.beats[cursor.beatIndex];
    // On a drum row, delete whichever variant is actually present — the user
    // means "remove what I see", not specifically the row's default piece.
    const present = beat?.notes.find((n) => rowForPiece(n.piece) === cursor.line);
    const target = (present as { piece: DrumPiece } | undefined)?.piece ?? piece;
    if (!target) return false;
    store().edit('Delete drum note', (draft) => {
      applied = E.toggleDrumNote(
        draft,
        cursor.trackId,
        cursor.measureIndex,
        cursor.beatIndex,
        target,
        store().entryDuration,
      );
    });
  }
  return applied;
}

/** Clears every note in the beat under the cursor. */
export function clearBeatAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Clear beat', (draft) => {
    E.clearBeat(draft, cursor.trackId, cursor.measureIndex, cursor.beatIndex);
  });
}

/** Removes the beat entirely, closing the gap. */
export function deleteBeatAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Delete beat', (draft) => {
    E.deleteBeat(draft, cursor.trackId, cursor.measureIndex, cursor.beatIndex);
  });
}


export function toggleTechniqueAtCursor(technique: Parameters<typeof E.toggleTechnique>[5]): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track || !isStringTrack(track)) return;

  const stringIndex = stringForLine(track, cursor.line);
  store().edit(`Toggle ${technique}`, (draft) => {
    E.toggleTechnique(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      stringIndex,
      technique,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Rhythm                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Arms the note value used for the next note entered.
 *
 * This never touches existing music. An earlier version also retimed the beat
 * under the cursor, on the theory that "picking a duration with a note selected
 * edits that note" — but the cursor is always sitting on something, so picking
 * a value silently rewrote whatever note happened to be underneath. That made
 * bar lengths change unpredictably, and on a full bar it shrank a note to
 * conjure up space that should not have existed. Changing an existing note is
 * now an explicit action: `applyDurationToCursorBeat`.
 */
export function setEntryDuration(duration: Fraction): void {
  store().setEntryDuration(duration);
}

/** True when the cursor sits on a beat whose duration could be changed. */
export function canApplyDurationToCursorBeat(): boolean {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return false;
  const beat = track.measures[cursor.measureIndex]?.beats[cursor.beatIndex];
  return Boolean(beat && beat.notes.length > 0);
}

/**
 * Retimes the beat under the cursor to the armed note value.
 *
 * Refused by the model when the bar has no room to grow, so lengthening the
 * last note of a full bar leaves the music untouched rather than silently
 * dropping something to make it fit.
 */
export function applyDurationToCursorBeat(): boolean {
  const { cursor, entryDuration } = store();
  if (!cursor) return false;

  let applied = false;
  store().edit('Change note value', (draft) => {
    applied = E.setBeatDuration(
      draft,
      cursor.trackId,
      cursor.measureIndex,
      cursor.beatIndex,
      entryDuration,
    );
  });
  if (!applied) {
    store().setNotice(
      `That would not fit in bar ${cursor.measureIndex + 1}. Shorten another note first.`,
    );
  }
  return applied;
}

export const shortenDuration = (): void => setEntryDuration(D.shorter(store().entryDuration));
export const lengthenDuration = (): void => setEntryDuration(D.longer(store().entryDuration));
export const cycleDots = (): void => setEntryDuration(D.cycleDots(store().entryDuration));
export const toggleTriplet = (): void => setEntryDuration(D.toggleTriplet(store().entryDuration));

/* -------------------------------------------------------------------------- */
/* Measures and tracks                                                        */
/* -------------------------------------------------------------------------- */

/** Sets the song's base tempo. Refused by the model outside 1-400 BPM. */
export function setTempo(bpm: number): boolean {
  let applied = false;
  store().edit('Tempo', (draft) => {
    applied = E.setTempo(draft, Math.round(bpm));
  });
  if (!applied) store().setNotice(`${Math.round(bpm)} BPM is outside the usable range.`);
  return applied;
}

/** Adjusts one track's mixer settings. */
export function setMixer(trackId: string, changes: Partial<Track['mixer']>): void {
  store().edit('Mixer', (draft) => {
    E.setMixer(draft, trackId, changes);
  });
}

export function insertMeasureAtCursor(): void {
  const { cursor } = store();
  store().edit('Insert bar', (draft) => E.insertMeasure(draft, cursor?.measureIndex ?? 0));
}

export function appendMeasure(): void {
  store().edit('Add bar', (draft) => E.appendMeasure(draft));
}

export function deleteMeasureAtCursor(): void {
  const { cursor } = store();
  if (!cursor) return;
  store().edit('Delete bar', (draft) => {
    E.deleteMeasure(draft, cursor.measureIndex);
  });
}

/** Moves the cursor to the next or previous track, keeping the bar position. */
export function stepTrack(delta: number): void {
  const { song, cursor } = store();
  if (!song || !cursor) return;

  const index = song.tracks.findIndex((t) => t.id === cursor.trackId);
  if (index < 0) return;
  const next = song.tracks[(index + delta + song.tracks.length) % song.tracks.length];
  if (!next) return;

  const lineCount = isStringTrack(next) ? next.tuning.length : DRUM_ROW_COUNT;
  store().setCursor({
    trackId: next.id,
    measureIndex: Math.min(cursor.measureIndex, Math.max(0, next.measures.length - 1)),
    beatIndex: 0,
    line: Math.min(cursor.line, lineCount - 1),
  });
}

/* -------------------------------------------------------------------------- */
/* Annotations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Adds an empty text note anchored to the cursor's bar and beat, and returns
 * its id so the caller can focus the new box for typing. Anchoring to the beat
 * the cursor sits on is the least surprising place: the user positioned the
 * cursor, so that is where "here" is.
 */
export function addAnnotationAtCursor(): string | null {
  const { song, cursor } = store();
  if (!song) return null;

  const bar = cursor?.measureIndex ?? 0;
  const track = currentTrack();
  const offset = cursor && track?.measures[bar]?.beats[cursor.beatIndex]?.start;
  const id = newAnnotationId();
  // The add and the typing that follows share a coalesce key, so placing a note
  // and writing it is a single undo step: one press of undo removes the note.
  store().edit(
    'Add text',
    (draft) => E.addAnnotation(draft, { id, bar, offset: offset ?? F.ZERO, text: '' }),
    `annotation:${id}`,
  );
  return id;
}

export function editAnnotationText(id: string, text: string): void {
  // Block body, not a concise return: these ops return a boolean, and Immer
  // rejects a producer that both returns a value and mutates the draft.
  store().edit(
    'Edit text',
    (draft) => {
      E.setAnnotationText(draft, id, text);
    },
    `annotation:${id}`,
  );
}

export function removeAnnotation(id: string): void {
  store().edit('Delete text', (draft) => {
    E.removeAnnotation(draft, id);
  });
}

/** Removes a note if it was left blank — how an accidental add cleans itself up. */
export function removeAnnotationIfEmpty(id: string): void {
  const annotation = store().song?.annotations.find((a) => a.id === id);
  if (annotation && annotation.text.trim() === '') removeAnnotation(id);
}

/* -------------------------------------------------------------------------- */
/* Cursor movement                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Moves one slot right, wrapping into the next bar at the end of the current
 * one — which is what makes typing a run of notes feel continuous rather than
 * stopping dead at every bar line.
 */
export function stepRight(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;

  const measure = track.measures[cursor.measureIndex];
  const lastSlot = measure ? measure.beats.length : 0;

  if (cursor.beatIndex >= lastSlot && cursor.measureIndex < track.measures.length - 1) {
    // Explicit fields, not a spread: moving off an insert cursor must drop its
    // between-notes position so the next note goes where the cursor now is.
    store().setCursor({
      trackId: cursor.trackId,
      measureIndex: cursor.measureIndex + 1,
      beatIndex: 0,
      line: cursor.line,
    });
    return;
  }
  store().moveCursor({ beat: 1 });
}

/** Moves one slot left, wrapping back into the previous bar. */
export function stepLeft(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;

  if (cursor.beatIndex === 0 && cursor.measureIndex > 0) {
    const previous = track.measures[cursor.measureIndex - 1];
    store().setCursor({
      trackId: cursor.trackId,
      measureIndex: cursor.measureIndex - 1,
      beatIndex: previous ? previous.beats.length : 0,
      line: cursor.line,
    });
    return;
  }
  store().moveCursor({ beat: -1 });
}

export const stepUp = (): void => store().moveCursor({ line: -1 });
export const stepDown = (): void => store().moveCursor({ line: 1 });

export function goToMeasureStart(): void {
  const { cursor } = store();
  if (cursor) {
    store().setCursor({
      trackId: cursor.trackId,
      measureIndex: cursor.measureIndex,
      beatIndex: 0,
      line: cursor.line,
    });
  }
}

export function goToMeasureEnd(): void {
  const { cursor } = store();
  const track = currentTrack();
  if (!cursor || !track) return;
  const measure = track.measures[cursor.measureIndex];
  store().setCursor({
    trackId: cursor.trackId,
    measureIndex: cursor.measureIndex,
    beatIndex: measure ? measure.beats.length : 0,
    line: cursor.line,
  });
}

