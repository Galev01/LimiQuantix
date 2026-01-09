import { useState, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getStoredTheme, toggleTheme } from '../lib/theme-store';

interface ThemeToggleProps {
  className?: string;
}

/**
 * Theme toggle button component for QVMRC.
 * Switches between light and dark modes.
 */
export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [theme, setTheme] = useState(getStoredTheme);
  
  const handleToggle = useCallback(() => {
    const newTheme = toggleTheme();
    setTheme(newTheme);
  }, []);
  
  return (
    <button
      onClick={handleToggle}
      className={`icon-btn ${className}`}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}

export default ThemeToggle;
