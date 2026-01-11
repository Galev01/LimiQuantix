import { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  FolderOpen,
  Trash2,
  Clock,
  Save,
  RotateCcw,
  Info,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'sonner';
import { useStoragePools } from '@/hooks/useStorage';

// Config stored in localStorage
interface ImageLibraryConfig {
  defaultStoragePoolId: string;
  downloadLocation: 'storage-pool' | 'local-cache';
  autoCleanupDays: number;
  autoCleanupEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_CONFIG: ImageLibraryConfig = {
  defaultStoragePoolId: '',
  downloadLocation: 'storage-pool',
  autoCleanupDays: 30,
  autoCleanupEnabled: false,
  logLevel: 'info',
};

const STORAGE_KEY = 'quantix-image-library-config';

export function ConfigPage() {
  const [config, setConfig] = useState<ImageLibraryConfig>(DEFAULT_CONFIG);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: storagePools } = useStoragePools();

  // Load config from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig({ ...DEFAULT_CONFIG, ...parsed });
      } catch {
        // Invalid JSON, use defaults
      }
    }
  }, []);

  const updateConfig = <K extends keyof ImageLibraryConfig>(key: K, value: ImageLibraryConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      setHasChanges(false);
      toast.success('Settings saved successfully');
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (!confirm('Reset all settings to defaults?')) return;
    setConfig(DEFAULT_CONFIG);
    localStorage.removeItem(STORAGE_KEY);
    setHasChanges(false);
    toast.success('Settings reset to defaults');
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-info/10 border border-info/30">
        <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-info">Image Library Configuration</p>
          <p className="text-xs text-text-muted mt-1">
            Configure default storage locations, cleanup policies, and logging preferences for the image library.
            Settings are stored locally in your browser.
          </p>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="space-y-6">
        {/* Storage Settings */}
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Database className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Storage Settings</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Default Storage Pool */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-text-primary">Default Storage Pool</label>
                <p className="text-xs text-text-muted mt-0.5">
                  Select the default storage pool for image downloads
                </p>
              </div>
              <select
                value={config.defaultStoragePoolId}
                onChange={(e) => updateConfig('defaultStoragePoolId', e.target.value)}
                className="w-64 px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="">Auto-select (first available)</option>
                {storagePools?.map(pool => (
                  <option key={pool.id} value={pool.id}>{pool.name}</option>
                ))}
              </select>
            </div>

            {/* Download Location */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-text-primary">Download Location</label>
                <p className="text-xs text-text-muted mt-0.5">
                  Where to store downloaded images
                </p>
              </div>
              <select
                value={config.downloadLocation}
                onChange={(e) => updateConfig('downloadLocation', e.target.value as 'storage-pool' | 'local-cache')}
                className="w-64 px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="storage-pool">Storage Pool (Recommended)</option>
                <option value="local-cache">Local Cache</option>
              </select>
            </div>
          </div>
        </div>

        {/* Cleanup Policy */}
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Auto-Cleanup Policy</h3>
          </div>
          <div className="p-4 space-y-4">
            {/* Enable Auto-Cleanup */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-text-primary">Enable Auto-Cleanup</label>
                <p className="text-xs text-text-muted mt-0.5">
                  Automatically remove unused images after a specified period
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoCleanupEnabled}
                  onChange={(e) => updateConfig('autoCleanupEnabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-bg-elevated peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
              </label>
            </div>

            {/* Cleanup Days */}
            {config.autoCleanupEnabled && (
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium text-text-primary">Cleanup After (Days)</label>
                  <p className="text-xs text-text-muted mt-0.5">
                    Delete unused images after this many days
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={config.autoCleanupDays}
                    onChange={(e) => updateConfig('autoCleanupDays', parseInt(e.target.value) || 30)}
                    className="w-24 px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary text-center focus:border-accent focus:outline-none"
                  />
                  <span className="text-sm text-text-muted">days</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Logging */}
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Logging</h3>
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-text-primary">Log Level</label>
                <p className="text-xs text-text-muted mt-0.5">
                  Set the verbosity of image library logs
                </p>
              </div>
              <select
                value={config.logLevel}
                onChange={(e) => updateConfig('logLevel', e.target.value as 'debug' | 'info' | 'warn' | 'error')}
                className="w-64 px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="debug">Debug (Verbose)</option>
                <option value="info">Info (Default)</option>
                <option value="warn">Warning</option>
                <option value="error">Error Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Current Configuration Summary */}
        <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium text-text-primary">Current Configuration</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-bg-base">
                <p className="text-xs text-text-muted">Storage Pool</p>
                <p className="text-sm font-medium text-text-primary mt-1">
                  {config.defaultStoragePoolId
                    ? storagePools?.find(p => p.id === config.defaultStoragePoolId)?.name || 'Unknown'
                    : 'Auto-select'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-bg-base">
                <p className="text-xs text-text-muted">Download Location</p>
                <p className="text-sm font-medium text-text-primary mt-1 capitalize">
                  {config.downloadLocation.replace('-', ' ')}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-bg-base">
                <p className="text-xs text-text-muted">Auto-Cleanup</p>
                <p className="text-sm font-medium text-text-primary mt-1">
                  {config.autoCleanupEnabled ? `${config.autoCleanupDays} days` : 'Disabled'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-bg-base">
                <p className="text-xs text-text-muted">Log Level</p>
                <p className="text-sm font-medium text-text-primary mt-1 capitalize">
                  {config.logLevel}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="warning" size="sm">
              <Clock className="w-3 h-3 mr-1" />
              Unsaved Changes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="w-4 h-4" />
            Reset to Defaults
          </Button>
          <Button
            variant="default"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? (
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Settings
          </Button>
        </div>
      </div>

      {/* Note about persistence */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-bg-surface border border-border">
        <Info className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-text-primary">Storage Note</p>
          <p className="text-xs text-text-muted mt-1">
            These settings are stored in your browser's local storage. They will persist across sessions
            but are specific to this browser. For server-wide settings, configure the control plane directly.
          </p>
        </div>
      </div>
    </div>
  );
}
