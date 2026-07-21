/**
 * Shows the input surface for whichever track the cursor is on.
 *
 * Both surfaces emit a `NoteInputEvent` and hand it to `applyNoteInput`; they
 * contain no editing logic of their own. That is what keeps them
 * interchangeable with a MIDI source later — the device decides what was
 * played, the editor decides what it means.
 *
 * The surface also mirrors the score back: while stopped it shows the beat
 * under the cursor, and while playing it follows the playhead. That is what
 * turns the illustration into something you can practise from — watch the
 * shapes go by on the neck instead of reading fret numbers off the staff.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as C from '../editor/commands';
import { drumInput, fretInput } from '../editor/input/events';
import { beatAtOffset } from '../model/song';
import { isStringTrack, type Beat, type DrumNote, type DrumPiece } from '../model/types';
import { usePlaybackStore } from '../store/playbackStore';
import { useSongStore } from '../store/songStore';
import { rowForPiece } from '../theory/drums';
import { DRUM_PIECE_TO_GM, midiToPitch, specOf, stringFretToMidi } from '../theory/midi';
import { DrumKit } from './DrumKit';
import { Fretboard } from './Fretboard';
import './instrument-panel.css';

const FLASH_MS = 140;

export function InstrumentPanel() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const playhead = usePlaybackStore((s) => s.position);
  // Paused counts as following. Pausing is how you stop to look at a shape, so
  // snapping back to the editing cursor at that exact moment takes away the
  // thing you paused for. Stop returns to the cursor.
  const running = usePlaybackStore((s) => s.status !== 'stopped');

  const [flash, setFlash] = useState<DrumPiece | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const track = song?.tracks.find((t) => t.id === cursor?.trackId);
  const trackId = track?.id;

  // Auditioning happens whether or not the note was written. Hearing what you
  // pointed at is the point of the illustration, and a bar being full is not a
  // reason to also make the instrument go silent.
  const handleDrumHit = useCallback(
    (piece: DrumPiece) => {
      C.applyNoteInput(drumInput(piece, { source: 'mouse' }));
      if (trackId) usePlaybackStore.getState().audition(DRUM_PIECE_TO_GM[piece], 'percussive', trackId);
      setFlash(piece);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
    },
    [trackId],
  );

  const handlePick = useCallback(
    (stringIndex: number, fret: number) => {
      C.applyNoteInput(fretInput(stringIndex, fret, { source: 'mouse' }));
      if (track && isStringTrack(track)) {
        usePlaybackStore
          .getState()
          .audition(stringFretToMidi(specOf(track), stringIndex, fret), 'pitched', track.id);
      }
    },
    [track],
  );

  const following = running && playhead !== undefined;

  // The beat to display. During playback the panel is a readout, so there is no
  // cursor note to single out of a chord.
  const beat: Beat | undefined = following
    ? beatAtOffset(track?.measures[playhead.bar], playhead.offset)
    : track && cursor
      ? track.measures[cursor.measureIndex]?.beats[cursor.beatIndex]
      : undefined;

  const cursorString = following || !track || !cursor ? null : C.stringForLine(track, cursor.line);

  // Keyed on the beat itself, which is stable between frames because the song
  // is. Without this the playhead's sixty-times-a-second clock would hand the
  // fretboard a fresh array every frame and re-render a few hundred SVG nodes
  // for a picture that only changes on each note.
  const marks = useMemo(
    () =>
      track
        ? C.positionsInBeat(track, beat, cursorString).map((p) => ({
            string: p.string,
            fret: p.fret,
            // While playing, every note of the beat is sounding, so every one
            // of them is filled. Outlining is for showing a shape you are about
            // to play; this is a shape you are hearing.
            emphasis: following || p.onCursorString,
          }))
        : [],
    [track, beat, cursorString, following],
  );

  const activePieces = useMemo(
    () => (beat ? (beat.notes as readonly DrumNote[]).map((n) => n.piece) : []),
    [beat],
  );

  if (!track || !cursor) return null;

  const hint = following ? 'Following the playhead' : null;

  if (isStringTrack(track)) {
    const spec = specOf(track);
    const names = marks.map((m) => midiToPitch(stringFretToMidi(spec, m.string, m.fret)).replace(/\d+$/, ''));

    return (
      <section className="qtm-instrument" aria-label="Fretboard input">
        <header className="qtm-instrument-header">
          <h2>{track.name}</h2>
          <span className="qtm-instrument-hint">
            {hint ?? (
              <>
                Click a fret to place a note at the cursor
                {track.capo > 0 && ` · capo ${track.capo}`}
              </>
            )}
          </span>
        </header>
        <Fretboard
          track={track}
          onPick={handlePick}
          activeString={following ? undefined : C.stringForLine(track, cursor.line)}
          marks={marks}
        />
        {names.length > 0 && (
          <p className="qtm-instrument-note">
            {following ? 'Playing' : 'On this beat'}: {names.join(' ')}
          </p>
        )}
      </section>
    );
  }

  const cursorRowPieces = activePieces.filter((p) => rowForPiece(p) === cursor.line);

  return (
    <section className="qtm-instrument" aria-label="Drum kit input">
      <header className="qtm-instrument-header">
        <h2>{track.name}</h2>
        <span className="qtm-instrument-hint">
          {hint ?? 'Click a drum, or use the letter keys. Hits land on the cursor’s beat.'}
        </span>
      </header>
      <DrumKit onHit={handleDrumHit} activePieces={activePieces} flashPiece={flash} />
      {(following ? activePieces.length > 0 : cursorRowPieces.length > 0) && (
        <p className="qtm-instrument-note">
          {following ? 'Playing' : 'On this beat'}: {activePieces.join(', ')}
        </p>
      )}
    </section>
  );
}
