/**
 * User preferences: appearance, typography and score layout.
 *
 * These are per-device, not per-song, so they live in localStorage rather than
 * in the song document — importing someone else's `.qtm` must not repaint your
 * editor. The song store owns musical data; this module owns how it looks.
 *
 * Every visual choice resolves to a CSS custom property or a layout option, the
 * two contracts the renderer already reads. Applying a setting is therefore just
 * writing a token (see `applyAppearance`) — no component re-mounts, and the PDF
 * exporter can later read the same tokens.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

export interface FontOption {
  readonly id: string;
  readonly label: string;
  /** The CSS font-family stack this option resolves to. */
  readonly stack: string;
}

// `inter` / `jetbrains` are self-hosted (see fonts.ts); the rest resolve to
// fonts already on the user's machine. Both honour "no CDN".
export const UI_FONTS: readonly FontOption[] = [
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  {
    id: 'system',
    label: 'System',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Times New Roman', serif" },
];

export const TAB_FONTS: readonly FontOption[] = [
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, monospace" },
  {
    id: 'system',
    label: 'System Mono',
    stack: "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace",
  },
  { id: 'courier', label: 'Courier', stack: "'Courier New', Courier, monospace" },
];

export interface AccentOption {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  /** Translucent fill for the edit caret, matched to the accent. */
  readonly cursor: string;
}

// One colour applied to both themes: these mid-tone hues stay legible on the
// light and the dark surface alike, so a single value avoids a per-theme table.
export const ACCENTS: readonly AccentOption[] = [
  { id: 'blue', label: 'Blue', color: '#2f6df6', cursor: 'rgb(47 109 246 / 22%)' },
  { id: 'violet', label: 'Violet', color: '#7c5cff', cursor: 'rgb(124 92 255 / 24%)' },
  { id: 'green', label: 'Green', color: '#1f9d55', cursor: 'rgb(31 157 85 / 24%)' },
  { id: 'amber', label: 'Amber', color: '#d9820b', cursor: 'rgb(217 130 11 / 26%)' },
  { id: 'rose', label: 'Rose', color: '#e0466e', cursor: 'rgb(224 70 110 / 24%)' },
];

/** Discrete size steps, shared by the UI-scale and tab-size controls. */
export interface SizeStep {
  readonly id: string;
  readonly label: string;
  readonly scale: number;
}

export const SIZE_STEPS: readonly SizeStep[] = [
  { id: 'small', label: 'S', scale: 0.9 },
  { id: 'normal', label: 'M', scale: 1 },
  { id: 'large', label: 'L', scale: 1.15 },
];

/** Bars-per-line choices. `null` means fit as many as the width allows. */
export const BARS_PER_LINE: readonly (number | null)[] = [null, 2, 3, 4, 5, 6, 7, 8];

export interface Settings {
  readonly theme: ThemeChoice;
  /** `AccentOption` id. */
  readonly accent: string;
  /** `UI_FONTS` id. */
  readonly uiFont: string;
  /** `TAB_FONTS` id. */
  readonly tabFont: string;
  /** UI text scale multiplier. */
  readonly uiScale: number;
  /** Tab (score) size multiplier — scales the SVG layout metrics together. */
  readonly tabScale: number;
  /** Hard cap on bars per system, or null to fit as many as fit the width. */
  readonly maxBarsPerSystem: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: 'blue',
  uiFont: 'inter',
  tabFont: 'jetbrains',
  uiScale: 1,
  tabScale: 1,
  maxBarsPerSystem: 6,
};

const byId = <T extends { id: string }>(list: readonly T[], id: string, fallback: T): T =>
  list.find((item) => item.id === id) ?? fallback;

/**
 * Writes the appearance settings onto the document root as CSS custom
 * properties. The renderer and the shell already read these tokens, so this is
 * the whole of "applying" a theme, accent or font — no re-render is triggered.
 */
export function applyAppearance(settings: Settings, root: HTMLElement): void {
  // An explicit theme pins `data-theme`; `system` removes it so the
  // prefers-color-scheme rules in score.css take over in both directions.
  if (settings.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = settings.theme;

  const accent = byId(ACCENTS, settings.accent, ACCENTS[0]!);
  root.style.setProperty('--qtm-accent', accent.color);
  root.style.setProperty('--qtm-cursor', accent.cursor);

  root.style.setProperty('--qtm-font-ui', byId(UI_FONTS, settings.uiFont, UI_FONTS[0]!).stack);
  root.style.setProperty('--qtm-font-tab', byId(TAB_FONTS, settings.tabFont, TAB_FONTS[0]!).stack);
  root.style.setProperty('--qtm-font-scale', String(settings.uiScale));
}
