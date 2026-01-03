import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { ArrowLeft, Monitor, Sliders, Info, Loader2 } from 'lucide-react';

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
      onClose();
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
      <div className="h-full flex items-center justify-center bg-[var(--bg-base)]">
        <Loader2 className="w-10 h-10 text-[var(--accent)] animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <header className="app-header flex items-center gap-4 px-6 py-5">
        <button
          onClick={onClose}
          className="icon-btn"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Settings</h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6 space-y-6">
        {/* Display Settings */}
        <section className="section">
          <div className="section-title">
            <Monitor className="w-5 h-5" />
            <span>Display</span>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <h4>Scale to fit window</h4>
              <p>Resize the display to match window size</p>
            </div>
            <button
              onClick={() => updateDisplay('scale_viewport', !config.display.scale_viewport)}
              className={`toggle ${config.display.scale_viewport ? 'active' : ''}`}
            />
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <h4>Show remote cursor</h4>
              <p>Display the VM's cursor alongside local cursor</p>
            </div>
            <button
              onClick={() => updateDisplay('show_remote_cursor', !config.display.show_remote_cursor)}
              className={`toggle ${config.display.show_remote_cursor ? 'active' : ''}`}
            />
          </div>
        </section>

        {/* Quality Settings */}
        <section className="section">
          <div className="section-title">
            <Sliders className="w-5 h-5" />
            <span>Quality</span>
          </div>

          <div className="form-group">
            <label className="label">Preferred Encoding</label>
            <select
              value={config.display.preferred_encoding}
              onChange={(e) => updateDisplay('preferred_encoding', e.target.value)}
              className="select"
            >
              <option value="tight">Tight (recommended)</option>
              <option value="zrle">ZRLE</option>
              <option value="hextile">Hextile</option>
              <option value="raw">Raw (fastest, most bandwidth)</option>
            </select>
          </div>

          <div className="form-group mt-6">
            <div className="flex justify-between mb-3">
              <label className="label mb-0">Image Quality</label>
              <span className="text-sm font-medium text-[var(--accent)]">
                {config.display.quality}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="9"
              value={config.display.quality}
              onChange={(e) => updateDisplay('quality', parseInt(e.target.value))}
              style={{ '--value': (config.display.quality / 9) * 100 } as React.CSSProperties}
            />
            <div className="flex justify-between mt-2 text-xs text-[var(--text-muted)]">
              <span>Low (faster)</span>
              <span>High (sharper)</span>
            </div>
          </div>

          <div className="form-group mt-6">
            <div className="flex justify-between mb-3">
              <label className="label mb-0">Compression Level</label>
              <span className="text-sm font-medium text-[var(--accent)]">
                {config.display.compression}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="9"
              value={config.display.compression}
              onChange={(e) => updateDisplay('compression', parseInt(e.target.value))}
              style={{ '--value': (config.display.compression / 9) * 100 } as React.CSSProperties}
            />
            <div className="flex justify-between mt-2 text-xs text-[var(--text-muted)]">
              <span>None</span>
              <span>Maximum</span>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="section">
          <div className="section-title">
            <Info className="w-5 h-5" />
            <span>About</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="app-brand-icon">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-[var(--text-primary)]">QVMRC</p>
              <p className="text-sm text-[var(--text-muted)]">
                Quantix Virtual Machine Remote Console
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                Version 0.1.0 • © 2026 LimiQuantix
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="footer-bar flex gap-3">
        <button
          onClick={onClose}
          className="btn btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          onClick={saveConfig}
          disabled={saving}
          className="btn btn-primary flex-1"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </button>
      </footer>
    </div>
  );
}
