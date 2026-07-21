/**
 * Shows the input surface for whichever track the cursor is on.
 *
 * Both surfaces emit a `NoteInputEvent` and hand it to `applyNoteInput`; they
 * contain no editing logic of their own. That is what keeps them
 * interchangeable with a MIDI source later — the device decides what was
 * played, the editor decides what it means.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as C from '../editor/commands';
import { drumInput, fretInput } from '../editor/input/events';
import { isStringTrack, type DrumPiece } from '../model/types';
import { useSongStore } from '../store/songStore';
import { rowForPiece } from '../theory/drums';
import { midiToPitch, specOf, stringFretToMidi } from '../theory/midi';
import { DrumKit } from './DrumKit';
import { Fretboard } from './Fretboard';
import './instrument-panel.css';

const FLASH_MS = 140;

export function InstrumentPanel() {
  const song = useSongStore((s) => s.song);
  const cursor = useSongStore((s) => s.cursor);
  const [flash, setFlash] = useState<DrumPiece | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const track = song?.tracks.find((t) => t.id === cursor?.trackId);

  const handleDrumHit = useCallback((piece: DrumPiece) => {
    C.applyNoteInput(drumInput(piece, { source: 'mouse' }));
    setFlash(piece);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const handlePick = useCallback((stringIndex: number, fret: number) => {
    C.applyNoteInput(fretInput(stringIndex, fret, { source: 'mouse' }));
  }, []);

  if (!track || !cursor) return null;

  if (isStringTrack(track)) {
    // The neck mirrors the beat the cursor is on, so selecting a chord in the
    // score shows its shape under the hand — the point being to practise from
    // the illustration rather than to read fret numbers off the staff.
    const sounding = C.soundingPositions(track, cursor);
    const marks = sounding.map((p) => ({
      string: p.string,
      fret: p.fret,
      emphasis: p.onCursorString,
    }));
    const spec = specOf(track);
    const names = sounding.map((p) =>
      midiToPitch(stringFretToMidi(spec, p.string, p.fret)).replace(/\d+$/, ''),
    );

    return (
      <section className="qtm-instrument" aria-label="Fretboard input">
        <header className="qtm-instrument-header">
          <h2>{track.name}</h2>
          <span className="qtm-instrument-hint">
            Click a fret to place a note at the cursor
            {track.capo > 0 && ` · capo ${track.capo}`}
          </span>
        </header>
        <Fretboard
          track={track}
          onPick={handlePick}
          activeString={C.stringForLine(track, cursor.line)}
          marks={marks}
        />
        {names.length > 0 && <p className="qtm-instrument-note">On this beat: {names.join(' ')}</p>}
      </section>
    );
  }

  // Pieces already on the cursor's beat, so the kit reflects the score.
  const beat = track.measures[cursor.measureIndex]?.beats[cursor.beatIndex];
  const activePieces = beat?.notes.map((n) => n.piece) ?? [];
  const cursorRowPieces = activePieces.filter((p) => rowForPiece(p) === cursor.line);

  return (
    <section className="qtm-instrument" aria-label="Drum kit input">
      <header className="qtm-instrument-header">
        <h2>{track.name}</h2>
        <span className="qtm-instrument-hint">
          Click a drum, or use the letter keys. Hits land on the cursor&rsquo;s beat.
        </span>
      </header>
      <DrumKit onHit={handleDrumHit} activePieces={activePieces} flashPiece={flash} />
      {cursorRowPieces.length > 0 && (
        <p className="qtm-instrument-note">On this beat: {activePieces.join(', ')}</p>
      )}
    </section>
  );
}
