// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENTS, applyAppearance, DEFAULT_SETTINGS, UI_FONTS } from './settings';

describe('applyAppearance', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('pins data-theme for an explicit choice', () => {
    applyAppearance({ ...DEFAULT_SETTINGS, theme: 'dark' }, root);
    expect(root.dataset.theme).toBe('dark');
  });

  it('removes data-theme for system, so the media query decides', () => {
    root.dataset.theme = 'dark';
    applyAppearance({ ...DEFAULT_SETTINGS, theme: 'system' }, root);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('writes the accent and its matched cursor fill', () => {
    const violet = ACCENTS.find((a) => a.id === 'violet')!;
    applyAppearance({ ...DEFAULT_SETTINGS, accent: 'violet' }, root);
    expect(root.style.getPropertyValue('--qtm-accent')).toBe(violet.color);
    expect(root.style.getPropertyValue('--qtm-cursor')).toBe(violet.cursor);
  });

  it('writes the font stacks and UI scale', () => {
    const inter = UI_FONTS.find((f) => f.id === 'inter')!;
    applyAppearance({ ...DEFAULT_SETTINGS, uiFont: 'inter', uiScale: 1.15 }, root);
    expect(root.style.getPropertyValue('--qtm-font-ui')).toBe(inter.stack);
    expect(root.style.getPropertyValue('--qtm-font-scale')).toBe('1.15');
  });

  it('falls back to the first option for an unknown id rather than throwing', () => {
    expect(() => applyAppearance({ ...DEFAULT_SETTINGS, accent: 'nope' }, root)).not.toThrow();
    expect(root.style.getPropertyValue('--qtm-accent')).toBe(ACCENTS[0]!.color);
  });
});
