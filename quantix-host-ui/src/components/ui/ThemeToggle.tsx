import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '../../stores/useThemeStore';

interface ThemeToggleProps {
  className?: string;
}

/**
 * Theme toggle button component.
 * Switches between light and dark modes.
 */
export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useThemeStore();
  
  return (
    <button
      onClick={toggleTheme}
      className={`
        flex items-center justify-center
        w-9 h-9 rounded-lg
        bg-bg-surface border border-border
        text-text-secondary
        hover:bg-bg-hover hover:text-text-primary
        transition-all duration-150 ease-out
        focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg-base
        ${className}
      `}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? (
        <Sun className="w-[18px] h-[18px]" />
      ) : (
        <Moon className="w-[18px] h-[18px]" />
      )}
    </button>
  );
}

export default ThemeToggle;
