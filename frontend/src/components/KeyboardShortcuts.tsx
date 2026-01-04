/**
 * KeyboardShortcuts - Global keyboard shortcut handler
 * 
 * Provides application-wide keyboard shortcuts for:
 * - Console navigation (Ctrl+1-9 for tabs)
 * - Quick console access (Ctrl+Shift+C)
 * - Fullscreen toggle (Ctrl+Shift+F)
 */

import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConsoleStore, useConsoleSessions } from '@/hooks/useConsoleStore';
import { showInfo } from '@/lib/toast';

interface KeyboardShortcutsProps {
  children: React.ReactNode;
}

export function KeyboardShortcuts({ children }: KeyboardShortcutsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessions = useConsoleSessions();
  const { setActiveSession } = useConsoleStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Ctrl+Shift+C - Open console for selected VM (when on VM page)
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        if (location.pathname.startsWith('/vms/')) {
          // On VM detail page, could trigger console modal
          showInfo('Use the Console button to open console');
        } else {
          // Navigate to console dock
          navigate('/consoles');
        }
        return;
      }

      // Ctrl+Shift+F - Toggle fullscreen
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {
            showInfo('Fullscreen not available');
          });
        } else {
          document.exitFullscreen();
        }
        return;
      }

      // Ctrl+1-9 - Switch console tabs (only on console dock page)
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          const session = sessions[num - 1];
          if (session) {
            e.preventDefault();
            setActiveSession(session.id);
            // Navigate to console dock if not already there
            if (location.pathname !== '/consoles') {
              navigate('/consoles');
            }
          }
        }
        return;
      }

      // Ctrl+Tab - Next console tab
      if (e.ctrlKey && e.key === 'Tab' && !e.shiftKey) {
        if (sessions.length > 1) {
          e.preventDefault();
          const currentIndex = sessions.findIndex(
            (s) => s.id === useConsoleStore.getState().activeSessionId
          );
          const nextIndex = (currentIndex + 1) % sessions.length;
          setActiveSession(sessions[nextIndex].id);
          if (location.pathname !== '/consoles') {
            navigate('/consoles');
          }
        }
        return;
      }

      // Ctrl+Shift+Tab - Previous console tab
      if (e.ctrlKey && e.key === 'Tab' && e.shiftKey) {
        if (sessions.length > 1) {
          e.preventDefault();
          const currentIndex = sessions.findIndex(
            (s) => s.id === useConsoleStore.getState().activeSessionId
          );
          const prevIndex = (currentIndex - 1 + sessions.length) % sessions.length;
          setActiveSession(sessions[prevIndex].id);
          if (location.pathname !== '/consoles') {
            navigate('/consoles');
          }
        }
        return;
      }

      // Escape - Exit fullscreen
      if (e.key === 'Escape' && document.fullscreenElement) {
        // Browser handles this, but we can add a toast
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, location.pathname, sessions, setActiveSession]);

  return <>{children}</>;
}

/**
 * Keyboard shortcuts reference for help dialogs
 */
export const KEYBOARD_SHORTCUTS = [
  { keys: ['Ctrl', '1-9'], description: 'Switch to console tab 1-9' },
  { keys: ['Ctrl', 'Tab'], description: 'Next console tab' },
  { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Previous console tab' },
  { keys: ['Ctrl', 'Shift', 'C'], description: 'Open console dock' },
  { keys: ['Ctrl', 'Shift', 'F'], description: 'Toggle fullscreen' },
  { keys: ['Ctrl', 'Alt', 'Delete'], description: 'Send Ctrl+Alt+Del to VM (in console)' },
  { keys: ['Escape'], description: 'Exit fullscreen' },
];
