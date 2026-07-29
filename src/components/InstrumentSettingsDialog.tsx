/**
 * Per-instrument settings panel.
 *
 * Currently holds a single control — tuning — but lives as its own dialog
 * (rather than folding into the mixer strip) because instrument settings are
 * expected to grow. Tuning is per-track, not per-song, since a document can
 * mix a drop-D guitar with a standard bass and each needs its own fretboard
 * math.
 */

import { useState } from 'react';
import * as C from '../editor/commands';
import { TUNING_PRESETS, presetKeyForTuning, type TuningPreset } from '../theory/midi';
import { notesOnStringsBeyond } from '../model/song';
import type { StringTrack } from '../model/types';
import { useDialogA11y } from './useDialogA11y';
import './instrument-settings.css';

export interface InstrumentSettingsDialogProps {
  track: StringTrack;
  onClose: () => void;
}

export function InstrumentSettingsDialog({ track, onClose }: InstrumentSettingsDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose);
  const presets = TUNING_PRESETS[track.kind];
  const currentKey = presetKeyForTuning(track.kind, track.tuning) ?? '';
  // A preset chosen but not yet confirmed, when it would drop notes.
  const [pending, setPending] = useState<TuningPreset | null>(null);

  function onChangeTuning(key: string): void {
    const preset = presets.find((p) => p.key === key);
    if (!preset) return;
    const dropped = notesOnStringsBeyond(track, preset.tuning.length);
    // Fewer strings AND notes actually on the vanishing strings → confirm first.
    if (preset.tuning.length < track.tuning.length && dropped > 0) {
      setPending(preset);
    } else {
      C.setTuning(track.id, preset.tuning);
    }
  }

  return (
    <div className="qtm-modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="qtm-instrument-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${track.name} settings`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qtm-drawer-header">
          <h2>{track.name} settings</h2>
        </header>

        <label className="qtm-field">
          <span className="qtm-field-label">Tuning</span>
          <select
            className="qtm-select"
            value={pending ? pending.key : currentKey}
            onChange={(e) => onChangeTuning(e.target.value)}
          >
            {currentKey === '' && (
              <option value="" disabled>
                Custom
              </option>
            )}
            {presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </select>
          <span className="qtm-export-hint">Strings, low to high</span>
          <div className="qtm-tuning-readout">{track.tuning.join('  ')}</div>
        </label>

        {pending && (
          <div className="qtm-tuning-warning" role="alert">
            <p>
              Switching to {pending.label} removes{' '}
              {track.tuning.length - pending.tuning.length} string
              {track.tuning.length - pending.tuning.length === 1 ? '' : 's'} and will delete{' '}
              {notesOnStringsBeyond(track, pending.tuning.length)} note
              {notesOnStringsBeyond(track, pending.tuning.length) === 1 ? '' : 's'}.
            </p>
            <div className="qtm-tuning-warning-actions">
              <button type="button" className="qtm-button" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="qtm-button qtm-button--danger"
                onClick={() => {
                  C.setTuning(track.id, pending.tuning);
                  setPending(null);
                }}
              >
                Apply anyway
              </button>
            </div>
          </div>
        )}

        <footer className="qtm-export-footer">
          <button type="button" className="qtm-button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
