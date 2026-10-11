// Світла / темна / системна тема. Режим зберігається в localStorage (ключ як у Wix).
import { store } from './util.js';

const KEY = 'siteThemeMode';
export const MODES = ['system', 'light', 'dark'];

export function getMode() {
  const m = store.get(KEY);
  return MODES.includes(m) ? m : 'system';
}

function systemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
}

export function effective(mode = getMode()) {
  return mode === 'dark' || (mode === 'system' && systemDark()) ? 'dark' : 'light';
}

export function applyTheme(mode = getMode()) {
  document.documentElement.dataset.theme = effective(mode);
  document.documentElement.dataset.themeMode = mode;
}

export function cycleMode() {
  const next = MODES[(MODES.indexOf(getMode()) + 1) % MODES.length];
  store.set(KEY, next);
  applyTheme(next);
  return next;
}

export function initTheme() {
  applyTheme();
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getMode() === 'system') applyTheme('system');
    });
  } catch (e) { /* старі браузери */ }
}
