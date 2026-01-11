import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Monitor, Sliders, Info, Loader2, Sparkles, Check, X, Settings as SettingsIcon } from 'lucide-react';

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
  const [saved, setSaved] = useState(false);

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
      setSaved(true);
      setTimeout(() => {
        onClose();
      }, 500);
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
      <div className="flex flex-col h-full max-h-[80vh]">
        <div className="modal-header">
          <div className="flex items-center gap-4">
            <div className="modal-header-icon">
              <SettingsIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="modal-title">Settings</h2>
              <p className="modal-subtitle">Configure display & quality</p>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-[var(--accent)] spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="modal-header">
        <div className="flex items-center gap-4">
          <div className="modal-header-icon">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-subtitle">Configure display & quality</p>
          </div>
        </div>
        <button onClick={onClose} className="icon-btn">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="modal-body overflow-y-auto flex-1 space-y-6">
        {/* Display Settings */}
        <section className="section">
          <div className="section-title">
            <Monitor />
            <span>Display</span>
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <h4>Scale to fit window</h4>
              <p>Automatically resize the display to match your window size</p>
            </div>
            <button
              onClick={() => updateDisplay('scale_viewport', !config.display.scale_viewport)}
              className={`toggle ${config.display.scale_viewport ? 'active' : ''}`}
            />
          </div>

          <div className="setting-row">
            <div className="setting-label">
              <h4>Show remote cursor</h4>
              <p>Display the VM's cursor alongside your local cursor</p>
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
            <Sliders />
            <span>Quality</span>
          </div>

          <div className="form-group">
            <label className="label">Preferred Encoding</label>
            <select
              value={config.display.preferred_encoding}
              onChange={(e) => updateDisplay('preferred_encoding', e.target.value)}
              className="select"
            >
              <option value="tight">Tight (Recommended)</option>
              <option value="zrle">ZRLE</option>
              <option value="hextile">Hextile</option>
              <option value="raw">Raw (Fastest, highest bandwidth)</option>
            </select>
          </div>

          <div className="form-group mt-6">
            <div className="flex items-center justify-between mb-4">
              <label className="label mb-0">Image Quality</label>
              <span className="text-sm font-bold text-[var(--accent)] bg-[var(--accent-light)] px-3 py-1 rounded-full">
                {config.display.quality}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="9"
              value={config.display.quality}
              onChange={(e) => updateDisplay('quality', parseInt(e.target.value))}
            />
            <div className="flex justify-between mt-3 text-xs text-[var(--text-muted)]">
              <span>Low (faster)</span>
              <span>High (sharper)</span>
            </div>
          </div>

          <div className="form-group mt-6">
            <div className="flex items-center justify-between mb-4">
              <label className="label mb-0">Compression Level</label>
              <span className="text-sm font-bold text-[var(--accent)] bg-[var(--accent-light)] px-3 py-1 rounded-full">
                {config.display.compression}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="9"
              value={config.display.compression}
              onChange={(e) => updateDisplay('compression', parseInt(e.target.value))}
            />
            <div className="flex justify-between mt-3 text-xs text-[var(--text-muted)]">
              <span>None</span>
              <span>Maximum</span>
            </div>
          </div>
        </section>

        {/* About */}
        <section className="section">
          <div className="section-title">
            <Info />
            <span>About</span>
          </div>

          <div className="flex items-center gap-5">
            <div className="app-brand-icon" style={{ width: 56, height: 56 }}>
              <Monitor className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="font-bold text-[var(--text-primary)] text-lg">qvmc</p>
                <span className="text-xs font-medium text-[var(--accent)] bg-[var(--accent-light)] px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  v0.1.0
                </span>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Quantix Virtual Machine Console
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-2 opacity-60">
                © 2026 LimiQuantix. All rights reserved.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="modal-footer">
        <button onClick={onClose} className="btn btn-secondary flex-1">
          Cancel
        </button>
        <button
          onClick={saveConfig}
          disabled={saving || saved}
          className="btn btn-primary flex-1"
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : saving ? (
            <>
              <Loader2 className="w-4 h-4 spinner" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </button>
      </div>
    </div>
  );
}
