/**
 * Clickable drum kit.
 *
 * Laid out as a kit seen from the player's seat rather than as a grid of
 * buttons: a drummer locates the snare and hats by position, not by reading
 * labels, so the spatial arrangement is the interface. Each pad shows its
 * keyboard letter so the illustration teaches the finger-drumming layout.
 */

import { useState } from 'react';
import type { DrumPiece } from '../model/types';
import { keyForDrumPiece } from '../editor/input/drumKeys';
import './drumkit.css';

interface Pad {
  readonly piece: DrumPiece;
  readonly label: string;
  /** Centre and radius in SVG units. */
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly shape: 'cymbal' | 'drum';
}

/**
 * Positions roughly match a right-handed kit. Cymbals ride above the drums,
 * toms sweep left to right in descending pitch, kick sits centre-front.
 */
const PADS: readonly Pad[] = [
  { piece: 'hihat', label: 'Hi-hat', cx: 72, cy: 78, r: 32, shape: 'cymbal' },
  { piece: 'hihatOpen', label: 'Open HH', cx: 72, cy: 24, r: 20, shape: 'cymbal' },
  { piece: 'crash', label: 'Crash', cx: 168, cy: 34, r: 33, shape: 'cymbal' },
  { piece: 'ride', label: 'Ride', cx: 330, cy: 40, r: 36, shape: 'cymbal' },
  { piece: 'china', label: 'China', cx: 414, cy: 30, r: 24, shape: 'cymbal' },

  { piece: 'tom1', label: 'Tom 1', cx: 196, cy: 116, r: 31, shape: 'drum' },
  { piece: 'tom2', label: 'Tom 2', cx: 268, cy: 112, r: 33, shape: 'drum' },
  { piece: 'floorTom', label: 'Floor', cx: 372, cy: 148, r: 38, shape: 'drum' },

  { piece: 'snare', label: 'Snare', cx: 116, cy: 158, r: 36, shape: 'drum' },
  { piece: 'kick', label: 'Kick', cx: 238, cy: 190, r: 46, shape: 'drum' },
  { piece: 'hihatPedal', label: 'HH pedal', cx: 50, cy: 196, r: 22, shape: 'cymbal' },
];

const VIEW_WIDTH = 460;
const VIEW_HEIGHT = 244;

export interface DrumKitProps {
  onHit: (piece: DrumPiece) => void;
  /** Pieces present at the cursor's beat, drawn as engaged. */
  activePieces?: readonly DrumPiece[];
  /** Piece flashed briefly after a hit, for feedback. */
  flashPiece?: DrumPiece | null;
}

export function DrumKit({ onHit, activePieces = [], flashPiece }: DrumKitProps) {
  const [hover, setHover] = useState<DrumPiece | null>(null);
  const active = new Set(activePieces);

  return (
    <div className="qtm-drumkit-wrap">
      <svg
        className="qtm-drumkit"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="group"
        aria-label="Drum kit"
        onPointerLeave={() => setHover(null)}
      >
        {PADS.map((pad) => {
          const isActive = active.has(pad.piece);
          const isFlash = flashPiece === pad.piece;
          const key = keyForDrumPiece(pad.piece);

          return (
            <g
              key={pad.piece}
              className={[
                'qtm-pad',
                `qtm-pad--${pad.shape}`,
                isActive ? 'qtm-pad--active' : '',
                isFlash ? 'qtm-pad--flash' : '',
                hover === pad.piece ? 'qtm-pad--hover' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onPointerEnter={() => setHover(pad.piece)}
              onPointerDown={() => onHit(pad.piece)}
              role="button"
              tabIndex={0}
              aria-label={`${pad.label}${key ? ` (${key.toUpperCase()})` : ''}`}
              aria-pressed={isActive}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onHit(pad.piece);
                }
              }}
            >
              <circle className="qtm-pad-body" cx={pad.cx} cy={pad.cy} r={pad.r} />
              {pad.shape === 'cymbal' && (
                <circle className="qtm-pad-bell" cx={pad.cx} cy={pad.cy} r={pad.r * 0.28} />
              )}
              {pad.shape === 'drum' && (
                <circle className="qtm-pad-rim" cx={pad.cx} cy={pad.cy} r={pad.r * 0.78} />
              )}
              <text className="qtm-pad-label" x={pad.cx} y={pad.cy - 3} textAnchor="middle">
                {pad.label}
              </text>
              {key && (
                <text className="qtm-pad-key" x={pad.cx} y={pad.cy + 10} textAnchor="middle">
                  {key.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
