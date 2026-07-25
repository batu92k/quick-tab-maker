/**
 * Preference store, backed by localStorage.
 *
 * Separate from the song store (IndexedDB) on purpose: preferences are about
 * this browser, not this song, and they must survive opening, importing or
 * deleting songs. localStorage is the right tool — the payload is tiny and read
 * synchronously at startup, so there is no flash of the wrong theme.
 */

import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const STORAGE_KEY = 'qtm.settings.v1';

function load(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Spread over the defaults so a preference added in a later version fills in
    // with its default rather than arriving undefined.
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(settings: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or quota exhausted — preferences just won't persist. Not
    // worth interrupting the user over.
  }
}

export interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

function values(state: SettingsState): Settings {
  const { update: _update, reset: _reset, ...rest } = state;
  return rest;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch);
    save(values(get()));
  },
  reset() {
    set(DEFAULT_SETTINGS);
    save(DEFAULT_SETTINGS);
  },
}));
