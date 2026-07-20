/**
 * Renders a `Layout` to SVG.
 *
 * This component is deliberately dumb: it takes positioned geometry and draws
 * it, computing nothing. All the musical decisions were made in `layout.ts`,
 * which is what lets the PDF exporter reuse the same geometry and produce a
 * page identical to the screen.
 *
 * Colours come from CSS custom properties so light/dark theming needs no
 * re-render, and `currentColor` is used where possible so the PDF exporter can
 * override the palette wholesale.
 */

import { memo } from 'react';
import * as F from '../model/fraction';
import type { Fraction } from '../model/fraction';
import { isStringTrack, type DrumNote, type Note } from '../model/types';
import { noteheadFor } from '../theory/drums';
import type {
  LaidOutBeat,
  LaidOutMeasure,
  LaidOutStaff,
  LaidOutSystem,
  Layout,
  LayoutOptions,
} from './layout';

/* -------------------------------------------------------------------------- */
/* Duration stems                                                             */
/* -------------------------------------------------------------------------- */

/**
 * How many flags/beams a duration carries: eighth = 1, sixteenth = 2, etc.
 *
 * Derived from the denominator rather than matched against a table so dotted
 * and tuplet durations — which are not powers of two — still resolve to the
 * right stem by falling back to the nearest base value below them.
 */
function flagCount(duration: Fraction): number {
  const value = F.toNumber(duration);
  if (value >= 0.5) return 0; // whole and half notes
  if (value >= 0.25) return 0; // quarter
  let flags = 0;
  let threshold = 0.125; // eighth
  while (value <= threshold + 1e-9 && flags < 4) {
    flags += 1;
    threshold /= 2;
  }
  return flags;
}

/** Whether the notehead is drawn hollow, as for half and whole notes. */
function isHollow(duration: Fraction): boolean {
  return F.toNumber(duration) >= 0.5;
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

interface BeatStemProps {
  beat: LaidOutBeat;
  baseline: number;
  options: LayoutOptions;
}

/** The rhythm indication drawn below a tab staff. */
const BeatStem = memo(function BeatStem({ beat, baseline, options }: BeatStemProps) {
  if (beat.isRest) {
    // Drawn as a shape rather than a music glyph: the SMuFL rest characters
    // need a music font, and an embedded font is a problem to solve once, in
    // the PDF exporter, not twice.
    const w = 7;
    const h = 4;
    return (
      <rect
        className="qtm-rest"
        x={beat.x - w / 2}
        y={baseline + options.stemHeight * 0.35}
        width={w}
        height={h}
        rx={1}
      />
    );
  }

  const top = baseline;
  const bottom = baseline + options.stemHeight;
  const flags = flagCount(beat.beat.duration);

  return (
    <g className="qtm-stem">
      <line x1={beat.x} y1={top} x2={beat.x} y2={bottom} />
      {Array.from({ length: flags }, (_, i) => (
        <line
          key={i}
          x1={beat.x}
          y1={bottom - i * 4}
          x2={beat.x + 6}
          y2={bottom - i * 4}
        />
      ))}
      {isHollow(beat.beat.duration) && <circle cx={beat.x} cy={bottom} r={2.5} fill="none" />}
    </g>
  );
});

interface StringNotesProps {
  measure: LaidOutMeasure;
  staff: LaidOutStaff;
  options: LayoutOptions;
}

/**
 * Fret numbers.
 *
 * Each number gets an opaque rectangle behind it to break the staff line, which
 * is how printed tab avoids digits colliding with the string they sit on.
 */
function StringNotes({ measure, options }: StringNotesProps) {
  return (
    <>
      {measure.beats.flatMap((beat) =>
        beat.notes.map((laidOut) => {
          const note = laidOut.note as Note;
          const width = laidOut.text.length * options.fontSize * 0.62 + 3;
          const muted = note.techniques.includes('palmMute') || note.techniques.includes('ghost');
          return (
            <g key={note.id} className={muted ? 'qtm-note qtm-note--muted' : 'qtm-note'}>
              <rect
                className="qtm-note-backdrop"
                x={laidOut.x - width / 2}
                y={laidOut.y - options.fontSize * 0.62}
                width={width}
                height={options.fontSize * 1.24}
              />
              <text
                x={laidOut.x}
                y={laidOut.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={options.fontSize}
              >
                {laidOut.text}
              </text>
              {renderTechniques(note, laidOut.x, laidOut.y, options)}
            </g>
          );
        }),
      )}
    </>
  );
}

/** Technique marks drawn above a fret number. */
function renderTechniques(note: Note, x: number, y: number, options: LayoutOptions) {
  const marks: string[] = [];
  if (note.techniques.includes('hammer')) marks.push('H');
  if (note.techniques.includes('pull')) marks.push('P');
  if (note.techniques.includes('bend')) marks.push('b');
  if (note.techniques.includes('vibrato')) marks.push('~');
  if (note.techniques.includes('slide')) marks.push('/');
  if (note.techniques.includes('harmonic')) marks.push('◇');
  if (marks.length === 0) return null;

  return (
    <text
      className="qtm-technique"
      x={x}
      y={y - options.lineSpacing * 0.72}
      textAnchor="middle"
      fontSize={options.fontSize * 0.8}
    >
      {marks.join('')}
    </text>
  );
}

/** Drum noteheads: crosses for cymbals, dots for drums. */
function DrumNotes({ measure, options }: StringNotesProps) {
  const r = options.lineSpacing * 0.3;
  return (
    <>
      {measure.beats.flatMap((beat) =>
        beat.notes.map((laidOut) => {
          const note = laidOut.note as DrumNote;
          const shape = noteheadFor(note.piece);
          const { x, y } = laidOut;
          const accent = note.articulation === 'accent';
          const ghost = note.articulation === 'ghost';

          return (
            <g
              key={note.id}
              className={`qtm-drum-note${accent ? ' qtm-drum-note--accent' : ''}${
                ghost ? ' qtm-drum-note--ghost' : ''
              }`}
            >
              {shape === 'dot' && <circle cx={x} cy={y} r={r} />}
              {(shape === 'cross' || shape === 'circledCross') && (
                <>
                  <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} />
                  <line x1={x - r} y1={y + r} x2={x + r} y2={y - r} />
                </>
              )}
              {shape === 'circledCross' && (
                <circle className="qtm-drum-ring" cx={x} cy={y} r={r * 1.7} fill="none" />
              )}
              {shape === 'diamond' && (
                <polygon points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`} />
              )}
              {accent && (
                <text className="qtm-accent" x={x} y={y - options.lineSpacing * 0.8} textAnchor="middle" fontSize={options.fontSize * 0.9}>
                  &gt;
                </text>
              )}
            </g>
          );
        }),
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                      */
/* -------------------------------------------------------------------------- */

interface StaffProps {
  staff: LaidOutStaff;
  system: LaidOutSystem;
  options: LayoutOptions;
}

const Staff = memo(function Staff({ staff, system, options }: StaffProps) {
  const isString = isStringTrack(staff.track);
  const lineBottom = staff.lineYs[staff.lineYs.length - 1] ?? staff.y;
  const left = system.contentLeft;
  const right = system.contentRight;

  return (
    <g className={`qtm-staff qtm-staff--${staff.track.kind}`}>
      {/* Horizontal lines */}
      {staff.lineYs.map((y, i) => (
        <line key={i} className="qtm-staff-line" x1={left} y1={y} x2={right} y2={y} />
      ))}

      {/* Row labels */}
      {staff.lineLabels.map((label, i) => (
        <text
          key={i}
          className="qtm-line-label"
          x={left - 8}
          y={staff.lineYs[i]}
          textAnchor="end"
          dominantBaseline="central"
          fontSize={options.fontSize * 0.85}
        >
          {label}
        </text>
      ))}

      {/* Track name, once per system */}
      <text
        className="qtm-track-name"
        x={options.marginX}
        y={staff.y - options.lineSpacing * 0.9}
        fontSize={options.fontSize * 0.95}
      >
        {staff.track.name}
      </text>

      {/* Bar lines */}
      {staff.measures.map((measure) => (
        <line
          key={`bar-${measure.measureIndex}`}
          className="qtm-barline"
          x1={measure.x}
          y1={staff.y}
          x2={measure.x}
          y2={lineBottom}
        />
      ))}
      <line className="qtm-barline" x1={right} y1={staff.y} x2={right} y2={lineBottom} />

      {/* Bar numbers, on the top staff only */}
      {staff.trackIndex === 0 &&
        staff.measures.map((measure) => (
          <text
            key={`num-${measure.measureIndex}`}
            className="qtm-bar-number"
            x={measure.x + 3}
            y={staff.y - options.lineSpacing * 0.5}
            fontSize={options.fontSize * 0.75}
          >
            {measure.measureIndex + 1}
          </text>
        ))}

      {/* Notes and rhythm */}
      {staff.measures.map((measure) => (
        <g key={measure.measure.id}>
          {isString ? (
            <StringNotes measure={measure} staff={staff} options={options} />
          ) : (
            <DrumNotes measure={measure} staff={staff} options={options} />
          )}
          {measure.beats.map((beat) => (
            <BeatStem
              key={beat.beat.id}
              beat={beat}
              baseline={lineBottom + options.lineSpacing * 0.5}
              options={options}
            />
          ))}
        </g>
      ))}
    </g>
  );
});

/* -------------------------------------------------------------------------- */
/* Score                                                                      */
/* -------------------------------------------------------------------------- */

export interface ScoreProps {
  layout: Layout;
  /** Drawn as a caret; supplied by the editor in phase 3. */
  cursor?: { x: number; y: number } | undefined;
  onPointerDown?: ((event: React.PointerEvent<SVGSVGElement>) => void) | undefined;
  className?: string | undefined;
}

export function Score({ layout, cursor, onPointerDown, className }: ScoreProps) {
  const { options } = layout;

  return (
    <svg
      className={`qtm-score${className ? ` ${className}` : ''}`}
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      onPointerDown={onPointerDown}
      role="img"
      aria-label="Tab score"
    >
      {layout.systems.map((system, i) => (
        <g key={i} className="qtm-system">
          {system.staves.map((staff) => (
            <Staff key={staff.track.id} staff={staff} system={system} options={options} />
          ))}
        </g>
      ))}

      {cursor && (
        <rect
          className="qtm-cursor"
          x={cursor.x - options.beatBaseWidth / 2}
          y={cursor.y - options.lineSpacing / 2}
          width={options.beatBaseWidth}
          height={options.lineSpacing}
          rx={2}
        />
      )}
    </svg>
  );
}
