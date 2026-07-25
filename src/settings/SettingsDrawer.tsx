/**
 * Settings drawer.
 *
 * A single home for every preference the header and toolbar used to scatter
 * around: appearance, typography and score layout. It writes straight to the
 * settings store, which persists and (via App) applies each change live, so the
 * drawer has no local state of its own — what you see is the store.
 */

import { useEffect } from 'react';
import {
  ACCENTS,
  BARS_PER_LINE,
  PAPER_OPTIONS,
  SIZE_STEPS,
  TAB_FONTS,
  UI_FONTS,
  type ThemeChoice,
} from './settings';
import { useSettingsStore } from './settingsStore';
import './settings.css';

export interface SettingsDrawerProps {
  onClose: () => void;
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Nearest size step id for a stored multiplier, so the segment shows selected. */
function stepId(scale: number): string {
  let best = SIZE_STEPS[0]!;
  for (const step of SIZE_STEPS) {
    if (Math.abs(step.scale - scale) < Math.abs(best.scale - scale)) best = step;
  }
  return best.id;
}

export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const settings = useSettingsStore();
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const uiStep = stepId(settings.uiScale);
  const tabStep = stepId(settings.tabScale);

  return (
    <div className="qtm-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="qtm-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="qtm-drawer-header">
          <h2>Settings</h2>
          <button type="button" className="qtm-button" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </header>

        <section className="qtm-settings-section">
          <h3>Appearance</h3>

          <div className="qtm-field">
            <span className="qtm-field-label">Theme</span>
            <div className="qtm-segmented" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`qtm-segment${settings.theme === t.value ? ' qtm-segment--on' : ''}`}
                  aria-pressed={settings.theme === t.value}
                  onClick={() => update({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="qtm-field">
            <span className="qtm-field-label">Accent</span>
            <div className="qtm-swatches" role="group" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`qtm-swatch${settings.accent === a.id ? ' qtm-swatch--on' : ''}`}
                  style={{ background: a.color }}
                  aria-pressed={settings.accent === a.id}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => update({ accent: a.id })}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="qtm-settings-section">
          <h3>Typography</h3>

          <label className="qtm-field">
            <span className="qtm-field-label">Interface font</span>
            <select
              className="qtm-select"
              value={settings.uiFont}
              onChange={(e) => update({ uiFont: e.target.value })}
            >
              {UI_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="qtm-field">
            <span className="qtm-field-label">Tab font</span>
            <select
              className="qtm-select"
              value={settings.tabFont}
              onChange={(e) => update({ tabFont: e.target.value })}
            >
              {TAB_FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <div className="qtm-field">
            <span className="qtm-field-label">Interface size</span>
            <div className="qtm-segmented" role="group" aria-label="Interface size">
              {SIZE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={`qtm-segment${uiStep === step.id ? ' qtm-segment--on' : ''}`}
                  aria-pressed={uiStep === step.id}
                  onClick={() => update({ uiScale: step.scale })}
                >
                  {step.label}
                </button>
              ))}
            </div>
          </div>

          <div className="qtm-field">
            <span className="qtm-field-label">Tab size</span>
            <div className="qtm-segmented" role="group" aria-label="Tab size">
              {SIZE_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={`qtm-segment${tabStep === step.id ? ' qtm-segment--on' : ''}`}
                  aria-pressed={tabStep === step.id}
                  onClick={() => update({ tabScale: step.scale })}
                >
                  {step.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="qtm-settings-section">
          <h3>Layout</h3>

          <label className="qtm-field">
            <span className="qtm-field-label">Bars per line</span>
            <select
              className="qtm-select"
              value={settings.maxBarsPerSystem ?? 'auto'}
              onChange={(e) =>
                update({ maxBarsPerSystem: e.target.value === 'auto' ? null : Number(e.target.value) })
              }
            >
              {BARS_PER_LINE.map((n) => (
                <option key={n ?? 'auto'} value={n ?? 'auto'}>
                  {n === null ? 'Auto (fit width)' : n}
                </option>
              ))}
            </select>
          </label>

          <label className="qtm-field">
            <span className="qtm-field-label">Paper size (PDF)</span>
            <select
              className="qtm-select"
              value={settings.paperSize}
              onChange={(e) => update({ paperSize: e.target.value as typeof settings.paperSize })}
            >
              {PAPER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <footer className="qtm-drawer-footer">
          <button type="button" className="qtm-button" onClick={reset}>
            Reset to defaults
          </button>
        </footer>
      </aside>
    </div>
  );
}
