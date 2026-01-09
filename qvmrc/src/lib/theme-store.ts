/**
 * Theme store for QVMRC with localStorage persistence.
 * Manages light/dark mode and applies data-theme attribute to document root.
 */

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'qvmrc-theme';

/**
 * Get the current theme from localStorage.
 */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  return 'dark';
}

/**
 * Set the theme and persist to localStorage.
 */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Toggle between light and dark mode.
 */
export function toggleTheme(): Theme {
  const current = getStoredTheme();
  const newTheme = current === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
  return newTheme;
}

/**
 * Initialize theme on app startup.
 * Call this in main.tsx before React renders.
 */
export function initializeTheme(): void {
  const theme = getStoredTheme();
  document.documentElement.setAttribute('data-theme', theme);
}
