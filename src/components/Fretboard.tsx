/**
 * Clickable fretboard.
 *
 * Drawn with the highest string on top so it matches the tab staff directly
 * above it — a player reading the tab and looking at the fretboard should not
 * have to mentally flip between them. Note that this is the opposite of a
 * guitar seen from the player's own seat, and the opposite of the document's
 * lowest-first tuning array; `lineForString` owns that conversion.
 *
 * Fret spacing is uniform rather than tapering like a real neck. A real taper
 * makes the high frets tiny, and this is an input surface first: every fret
 * needs to be an equally easy click target.
 */

import { memo, useMemo, useState } from 'react';
import type { StringTrack } from '../model/types';
import { midiToPitch, midiToPitchClass, specOf, stringFretToMidi } from '../theory/midi';
import './fretboard.css';

/** Frets carrying position dots on a standard neck. */
const SINGLE_MARKERS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_MARKERS = new Set([12, 24]);

/** A position to draw on the neck because it is sounding in the score. */
export interface FretboardMark {
  readonly string: number;
  readonly fret: number;
  /** Drawn filled rather than outlined — the note the cursor is on. */
  readonly emphasis?: boolean;
}

export interface FretboardProps {
  track: StringTrack;
  /** Called with a document string index and fret when a position is clicked. */
  onPick: (stringIndex: number, fret: number) => void;
  /** Visual string index the editing cursor is on, to highlight that string. */
  activeString?: number | undefined;
  /** Highest fret to draw. Defaults to the track's own fret count. */
  maxFret?: number | undefined;
  /** Positions from the score to show on the neck, for practising a shape. */
  marks?: readonly FretboardMark[] | undefined;
  /**
   * Faint highlight of the current key's scale across the whole neck: every
   * in-scale position, with the tonic and any selected chord's tones standing
   * out. Purely a guide — it sits behind the sounding `marks` and the hover
   * preview so it never obscures what the player is actually doing.
   */
  scale?: ScaleOverlay | null | undefined;
}

export interface ScaleOverlay {
  /** Pitch classes 0–11 that belong to the scale. */
  readonly pitchClasses: readonly number[];
  /** Pitch class of the tonic, drawn as the root. */
  readonly root: number;
  /** Pitch classes of a selected chord's tones, drawn strongest. */
  readonly chord?: readonly number[] | undefined;
}

const NUT_WIDTH = 8;
const OPEN_COLUMN = 30;
const STRING_GAP = 22;
const FRET_WIDTH = 44;
const TOP = 26;

/**
 * Memoised because the playhead re-renders its parent on every animation frame
 * while the neck itself only changes on each note. A guitar neck is a few
 * hundred SVG nodes; rebuilding it sixty times a second to move one dot is
 * exactly the waste `marks` is memoised upstream to avoid.
 */
export const Fretboard = memo(function Fretboard({
  track,
  onPick,
  activeString,
  maxFret,
  marks = [],
  scale,
}: FretboardProps) {
  const [hover, setHover] = useState<{ string: number; fret: number } | null>(null);

  const fretCount = Math.min(maxFret ?? track.fretCount, track.fretCount);
  const stringCount = track.tuning.length;
  const spec = useMemo(() => specOf(track), [track]);

  const width = OPEN_COLUMN + NUT_WIDTH + fretCount * FRET_WIDTH + 16;
  const height = TOP + (stringCount - 1) * STRING_GAP + 34;
  const neckLeft = OPEN_COLUMN + NUT_WIDTH;

  /** x of the centre of a fret cell; fret 0 is the open-string column. */
  const cellX = (fret: number): number =>
    fret === 0 ? OPEN_COLUMN / 2 : neckLeft + (fret - 1) * FRET_WIDTH + FRET_WIDTH / 2;

  /** y of a string, drawn highest-pitched first. */
  const stringY = (stringIndex: number): number =>
    TOP + (stringCount - 1 - stringIndex) * STRING_GAP;

  const noteName = (stringIndex: number, fret: number): string =>
    midiToPitch(stringFretToMidi(spec, stringIndex, fret)).replace(/\d+$/, '');

  // Every in-scale position on the neck, classified for styling. Recomputed only
  // when the key, tuning or drawn range changes — not on the playhead's frame.
  const scaleCells = useMemo(() => {
    if (!scale) return [];
    const inScale = new Set(scale.pitchClasses);
    const inChord = new Set(scale.chord ?? []);
    const cells: { string: number; fret: number; kind: 'root' | 'chord' | 'scale' }[] = [];
    for (let s = 0; s < stringCount; s++) {
      for (let f = 0; f <= fretCount; f++) {
        const pc = midiToPitchClass(stringFretToMidi(spec, s, f));
        if (!inScale.has(pc) && !inChord.has(pc)) continue;
        const kind = inChord.has(pc) ? 'chord' : pc === scale.root ? 'root' : 'scale';
        cells.push({ string: s, fret: f, kind });
      }
    }
    return cells;
  }, [scale, spec, stringCount, fretCount]);

  return (
    <div className="qtm-fretboard-wrap">
      <svg
        className="qtm-fretboard"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${track.name} fretboard`}
        onPointerLeave={() => setHover(null)}
      >
        {/* Neck surface */}
        <rect
          className="qtm-fb-neck"
          x={neckLeft}
          y={TOP - STRING_GAP / 2}
          width={fretCount * FRET_WIDTH}
          height={(stringCount - 1) * STRING_GAP + STRING_GAP}
          rx={2}
        />

        {/* Position markers, behind the strings */}
        {Array.from({ length: fretCount }, (_, i) => i + 1).map((fret) => {
          const midY = TOP + ((stringCount - 1) * STRING_GAP) / 2;
          if (DOUBLE_MARKERS.has(fret)) {
            return (
              <g key={`m${fret}`} className="qtm-fb-marker">
                <circle cx={cellX(fret)} cy={midY - STRING_GAP * 0.8} r={5} />
                <circle cx={cellX(fret)} cy={midY + STRING_GAP * 0.8} r={5} />
              </g>
            );
          }
          if (SINGLE_MARKERS.has(fret)) {
            return (
              <circle key={`m${fret}`} className="qtm-fb-marker" cx={cellX(fret)} cy={midY} r={5} />
            );
          }
          return null;
        })}

        {/* Nut, or capo when one is fitted */}
        <rect
          className={track.capo > 0 ? 'qtm-fb-capo' : 'qtm-fb-nut'}
          x={track.capo > 0 ? neckLeft + (track.capo - 1) * FRET_WIDTH + FRET_WIDTH - 3 : OPEN_COLUMN}
          y={TOP - STRING_GAP / 2}
          width={NUT_WIDTH}
          height={(stringCount - 1) * STRING_GAP + STRING_GAP}
          rx={2}
        />

        {/* Fret wires */}
        {Array.from({ length: fretCount }, (_, i) => i + 1).map((fret) => (
          <line
            key={`f${fret}`}
            className="qtm-fb-fret"
            x1={neckLeft + fret * FRET_WIDTH}
            y1={TOP - STRING_GAP / 2}
            x2={neckLeft + fret * FRET_WIDTH}
            y2={TOP + (stringCount - 1) * STRING_GAP + STRING_GAP / 2}
          />
        ))}

        {/* Strings, thicker toward the bass */}
        {track.tuning.map((_, stringIndex) => (
          <line
            key={`s${stringIndex}`}
            className={`qtm-fb-string${activeString === stringIndex ? ' qtm-fb-string--active' : ''}`}
            x1={OPEN_COLUMN}
            y1={stringY(stringIndex)}
            x2={width - 8}
            y2={stringY(stringIndex)}
            strokeWidth={0.8 + (stringCount - 1 - stringIndex) * 0.32}
          />
        ))}

        {/* Fret numbers */}
        {Array.from({ length: fretCount + 1 }, (_, fret) => (
          <text
            key={`n${fret}`}
            className="qtm-fb-fretnum"
            x={cellX(fret)}
            y={height - 16}
            textAnchor="middle"
          >
            {fret}
          </text>
        ))}

        {/* Open-string names, centred on their own string.
            Offsetting these upward reads as labelling the string above, which
            is actively misleading on an instrument where adjacent strings are
            only a fourth apart. The backdrop keeps them legible over the line. */}
        {track.tuning.map((pitch, stringIndex) => (
          <g key={`t${stringIndex}`}>
            <rect
              className="qtm-fb-tuning-backdrop"
              x={2}
              y={stringY(stringIndex) - 7}
              width={OPEN_COLUMN - 6}
              height={14}
              rx={3}
            />
            <text
              className="qtm-fb-tuning"
              x={OPEN_COLUMN / 2 - 1}
              y={stringY(stringIndex)}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {pitch.replace(/\d+$/, '')}
            </text>
          </g>
        ))}

        {/* Scale guide, behind everything interactive. Roots are ringed, chord
            tones filled solid, plain scale tones faint, so the eye reads the
            key's shape without mistaking it for a note that is actually played. */}
        {scaleCells.map((cell) => (
          <circle
            key={`sc${cell.string}-${cell.fret}`}
            className={`qtm-fb-scale qtm-fb-scale--${cell.kind}`}
            cx={cellX(cell.fret)}
            cy={stringY(cell.string)}
            r={cell.kind === 'scale' ? 4.5 : 8}
          />
        ))}

        {/* Notes sounding at the cursor's beat.
            A mark can name a fret past the drawn range (a shorter `maxFret`, or
            a note left behind by a retuning), so anything off the board is
            dropped rather than drawn at the edge where it would read as a
            position the player could actually reach — and `noteName` throws on
            an out-of-range position rather than inventing a pitch. */}
        {marks
          .filter(
            (mark) =>
              mark.fret >= 0 &&
              mark.fret <= fretCount &&
              mark.string >= 0 &&
              mark.string < stringCount,
          )
          .map((mark) => (
            <g
              key={`k${mark.string}-${mark.fret}`}
              className={`qtm-fb-mark${mark.emphasis ? ' qtm-fb-mark--cursor' : ''}`}
            >
              <circle cx={cellX(mark.fret)} cy={stringY(mark.string)} r={9} />
              <text
                x={cellX(mark.fret)}
                y={stringY(mark.string)}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {noteName(mark.string, mark.fret)}
              </text>
            </g>
          ))}

        {/* Hit targets. Drawn last so they sit above the decoration. */}
        {track.tuning.map((_, stringIndex) =>
          Array.from({ length: fretCount + 1 }, (_, fret) => {
            const isHover = hover?.string === stringIndex && hover.fret === fret;
            const muted = track.capo > 0 && fret > 0 && fret < track.capo;
            return (
              <g key={`h${stringIndex}-${fret}`}>
                <rect
                  className="qtm-fb-hit"
                  x={cellX(fret) - (fret === 0 ? OPEN_COLUMN : FRET_WIDTH) / 2}
                  y={stringY(stringIndex) - STRING_GAP / 2}
                  width={fret === 0 ? OPEN_COLUMN : FRET_WIDTH}
                  height={STRING_GAP}
                  onPointerEnter={() => setHover({ string: stringIndex, fret })}
                  onPointerDown={() => !muted && onPick(stringIndex, fret)}
                />
                {isHover && (
                  <g className={`qtm-fb-preview${muted ? ' qtm-fb-preview--muted' : ''}`}>
                    <circle cx={cellX(fret)} cy={stringY(stringIndex)} r={9} />
                    <text
                      x={cellX(fret)}
                      y={stringY(stringIndex)}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {muted ? '' : noteName(stringIndex, fret)}
                    </text>
                  </g>
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
});
