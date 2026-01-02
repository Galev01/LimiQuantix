import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { ArrowLeft, Monitor, Sliders, Info } from 'lucide-react';

interface DisplaySettings {
  scale_viewport: boolean;
  show_remote_cursor: boolean;
  preferred_encoding: string;
  quality: number;
  compression: number;
}

interface Config {
  display: DisplaySettings;
  last_control_plane_url?: string;
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await invoke<Config>('get_config');
      setConfig(result);
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    setSaving(true);
    try {
      await invoke('save_config', { config });
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const updateDisplay = (key: keyof DisplaySettings, value: boolean | string | number) => {
    if (!config) return;
    setConfig({
      ...config,
      display: {
        ...config.display,
        [key]: value,
      },
    });
  };

  if (!config) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)]">
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--text-muted)]" />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Settings</h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* Display Settings */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Monitor className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Display</h2>
          </div>

          <div className="space-y-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
            {/* Scale Viewport */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[var(--text-primary)]">Scale to fit window</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Resize the display to fit the window
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.display.scale_viewport}
                  onChange={(e) => updateDisplay('scale_viewport', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[var(--bg-elevated)] peer-focus:outline-none rounded-full peer 
                                peer-checked:after:translate-x-full peer-checked:after:border-white 
                                after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
                                after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all 
                                peer-checked:bg-[var(--accent)]" />
              </label>
            </div>

            {/* Show Remote Cursor */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[var(--text-primary)]">Show remote cursor</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Display the VM's cursor in addition to local cursor
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.display.show_remote_cursor}
                  onChange={(e) => updateDisplay('show_remote_cursor', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[var(--bg-elevated)] peer-focus:outline-none rounded-full peer 
                                peer-checked:after:translate-x-full peer-checked:after:border-white 
                                after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
                                after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all 
                                peer-checked:bg-[var(--accent)]" />
              </label>
            </div>
          </div>
        </section>

        {/* Quality Settings */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sliders className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Quality</h2>
          </div>

          <div className="space-y-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
            {/* Encoding */}
            <div>
              <p className="text-[var(--text-primary)] mb-2">Preferred Encoding</p>
              <select
                value={config.display.preferred_encoding}
                onChange={(e) => updateDisplay('preferred_encoding', e.target.value)}
                className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg
                           text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="tight">Tight (recommended)</option>
                <option value="zrle">ZRLE</option>
                <option value="hextile">Hextile</option>
                <option value="raw">Raw (fastest, most bandwidth)</option>
              </select>
            </div>

            {/* Quality slider */}
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-[var(--text-primary)]">Quality</p>
                <span className="text-[var(--text-muted)]">{config.display.quality}</span>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                value={config.display.quality}
                onChange={(e) => updateDisplay('quality', parseInt(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>Low (fast)</span>
                <span>High (slow)</span>
              </div>
            </div>

            {/* Compression slider */}
            <div>
              <div className="flex justify-between mb-2">
                <p className="text-[var(--text-primary)]">Compression</p>
                <span className="text-[var(--text-muted)]">{config.display.compression}</span>
              </div>
              <input
                type="range"
                min="0"
                max="9"
                value={config.display.compression}
                onChange={(e) => updateDisplay('compression', parseInt(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>None</span>
                <span>Maximum</span>
              </div>
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-sm font-medium text-[var(--text-primary)]">About</h2>
          </div>

          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
            <p className="text-[var(--text-primary)] font-medium">QVMRC</p>
            <p className="text-sm text-[var(--text-muted)]">Quantix Virtual Machine Remote Console</p>
            <p className="text-xs text-[var(--text-muted)] mt-2">Version 0.1.0</p>
            <p className="text-xs text-[var(--text-muted)]">© 2024 LimiQuantix</p>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-[var(--border)]">
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-[var(--bg-elevated)] rounded-lg
                       text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={saveConfig}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-[var(--accent)] rounded-lg
                       text-white hover:bg-[var(--accent-hover)] transition-colors
                       disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </footer>
    </div>
  );
}
