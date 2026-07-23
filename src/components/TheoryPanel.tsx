/**
 * Key, scale and chord helper.
 *
 * Reads the song's key and derives everything else — the scale tones, the
 * diatonic chords and a few stock progressions — from `theory/scale`, so the
 * panel holds no music theory of its own. Choosing a chord lifts its pitch
 * classes to the parent, which paints them on the fretboard; the panel and the
 * neck never disagree because they read the same numbers.
 */

import { useMemo } from 'react';
import type { Mode, SongKey } from '../model/types';
import {
  diatonicChords,
  scaleInfo,
  suggestedProgressions,
  type DiatonicChord,
} from '../theory/scale';
import './theory-panel.css';

const TONICS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'dorian', label: 'Dorian' },
  { value: 'phrygian', label: 'Phrygian' },
  { value: 'lydian', label: 'Lydian' },
  { value: 'mixolydian', label: 'Mixolydian' },
  { value: 'locrian', label: 'Locrian' },
  { value: 'harmonicMinor', label: 'Harmonic minor' },
  { value: 'melodicMinor', label: 'Melodic minor' },
  { value: 'majorPentatonic', label: 'Major pentatonic' },
  { value: 'minorPentatonic', label: 'Minor pentatonic' },
  { value: 'blues', label: 'Blues' },
];

export interface TheoryPanelProps {
  songKey: SongKey;
  onChangeKey: (key: SongKey) => void;
  showScale: boolean;
  onToggleScale: (show: boolean) => void;
  /** Currently highlighted chord, matched by root+symbol. */
  selectedChord: DiatonicChord | null;
  onSelectChord: (chord: DiatonicChord | null) => void;
}

const sameChord = (a: DiatonicChord | null, b: DiatonicChord): boolean =>
  a !== null && a.degree === b.degree && a.symbol === b.symbol;

export function TheoryPanel({
  songKey,
  onChangeKey,
  showScale,
  onToggleScale,
  selectedChord,
  onSelectChord,
}: TheoryPanelProps) {
  const info = useMemo(() => scaleInfo(songKey), [songKey]);
  const chords = useMemo(() => diatonicChords(songKey), [songKey]);
  const progressions = useMemo(() => suggestedProgressions(songKey), [songKey]);

  const pick = (chord: DiatonicChord) =>
    onSelectChord(sameChord(selectedChord, chord) ? null : chord);

  return (
    <section className="qtm-theory" aria-label="Key and scale helper">
      <header className="qtm-theory-header">
        <h2>Key &amp; scale</h2>
        <label className="qtm-theory-toggle">
          <input
            type="checkbox"
            checked={showScale}
            onChange={(e) => onToggleScale(e.target.checked)}
          />
          Show on fretboard
        </label>
      </header>

      <div className="qtm-theory-key">
        <label>
          <span>Root</span>
          <select
            value={songKey.tonic}
            onChange={(e) => onChangeKey({ ...songKey, tonic: e.target.value })}
          >
            {(TONICS.includes(songKey.tonic as (typeof TONICS)[number])
              ? TONICS
              : [songKey.tonic, ...TONICS]
            ).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Scale</span>
          <select
            value={songKey.mode}
            onChange={(e) => onChangeKey({ ...songKey, mode: e.target.value as Mode })}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="qtm-theory-scale" aria-label="Scale notes">
        {info.notes.map((note, i) => (
          <div
            key={`${note}-${i}`}
            className={`qtm-theory-degree${i === 0 ? ' qtm-theory-degree--root' : ''}`}
          >
            <span className="qtm-theory-degree-num">{info.degrees[i]}</span>
            <span className="qtm-theory-degree-note">{note}</span>
          </div>
        ))}
      </div>

      {chords.length > 0 ? (
        <div className="qtm-theory-chords" aria-label="Diatonic chords">
          {chords.map((chord) => (
            <button
              key={chord.degree}
              type="button"
              className={`qtm-theory-chord${
                sameChord(selectedChord, chord) ? ' qtm-theory-chord--on' : ''
              }`}
              aria-pressed={sameChord(selectedChord, chord)}
              onClick={() => pick(chord)}
            >
              <span className="qtm-theory-roman">{chord.roman}</span>
              <span className="qtm-theory-symbol">{chord.symbol}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="qtm-theory-empty">
          This scale has no diatonic chords — it’s a colour palette for melody
          rather than harmony.
        </p>
      )}

      {progressions.length > 0 && (
        <div className="qtm-theory-progressions">
          <h3>Try these</h3>
          {progressions.map((prog) => (
            <div key={prog.label} className="qtm-theory-progression">
              {prog.chords.map((chord, i) => (
                <button
                  key={`${prog.label}-${i}`}
                  type="button"
                  className={`qtm-theory-prog-chord${
                    sameChord(selectedChord, chord) ? ' qtm-theory-prog-chord--on' : ''
                  }`}
                  onClick={() => pick(chord)}
                  title={chord.symbol}
                >
                  {chord.roman}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
