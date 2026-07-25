/**
 * PDF export options.
 *
 * A small modal that gathers the choices that only matter at export time —
 * paper size, orientation and how many bars go on each line — then hands off to
 * the caller to build the file. The controls write straight to the settings
 * store, so the last choices are remembered for next time.
 */

import { useEffect } from 'react';
import { PAPER_OPTIONS, PDF_BARS_PER_LINE, type PageOrientation } from './settings';
import { useSettingsStore } from './settingsStore';
import './settings.css';
import './pdf-export.css';

export interface PdfExportDialogProps {
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
}

const ORIENTATIONS: { value: PageOrientation; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

export function PdfExportDialog({ onClose, onExport, exporting }: PdfExportDialogProps) {
  const settings = useSettingsStore();
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !exporting) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, exporting]);

  return (
    <div className="qtm-modal-backdrop" onClick={() => !exporting && onClose()} role="presentation">
      <div
        className="qtm-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export PDF"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qtm-drawer-header">
          <h2>Export PDF</h2>
        </header>

        <div className="qtm-field">
          <span className="qtm-field-label">Paper size</span>
          <div className="qtm-segmented" role="group" aria-label="Paper size">
            {PAPER_OPTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`qtm-segment${settings.paperSize === p.id ? ' qtm-segment--on' : ''}`}
                aria-pressed={settings.paperSize === p.id}
                onClick={() => update({ paperSize: p.id })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="qtm-field">
          <span className="qtm-field-label">Orientation</span>
          <div className="qtm-segmented" role="group" aria-label="Orientation">
            {ORIENTATIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`qtm-segment${settings.pdfOrientation === o.value ? ' qtm-segment--on' : ''}`}
                aria-pressed={settings.pdfOrientation === o.value}
                onClick={() => update({ pdfOrientation: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <label className="qtm-field">
          <span className="qtm-field-label">Bars per line</span>
          <select
            className="qtm-select"
            value={settings.pdfBarsPerLine ?? 'auto'}
            onChange={(e) =>
              update({ pdfBarsPerLine: e.target.value === 'auto' ? null : Number(e.target.value) })
            }
          >
            {PDF_BARS_PER_LINE.map((n) => (
              <option key={n ?? 'auto'} value={n ?? 'auto'}>
                {n === null ? 'Auto (fit the page)' : `${n} per line`}
              </option>
            ))}
          </select>
          <span className="qtm-export-hint">
            A fixed count sizes every line the same, shrinking busy bars to fit.
          </span>
        </label>

        <footer className="qtm-export-footer">
          <button type="button" className="qtm-button" onClick={onClose} disabled={exporting}>
            Cancel
          </button>
          <button
            type="button"
            className="qtm-button qtm-button--primary"
            onClick={onExport}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </footer>
      </div>
    </div>
  );
}
