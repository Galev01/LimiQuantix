/**
 * EditDisplaySettingsModal - Edit VM display/console configuration
 * 
 * Allows editing display type (VNC/SPICE), port, password, and graphics settings.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Monitor, Eye, EyeOff, RefreshCw, Loader2, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/Toggle';
import { type ApiVM } from '@/hooks/useVMs';

interface EditDisplaySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  onSave: (settings: DisplaySettings) => Promise<void>;
}

interface DisplaySettings {
  type: 'VNC' | 'SPICE';
  port: number | 'auto';
  password: string;
  listen: string;
  enableClipboard: boolean;
  enableAudio: boolean;
}

const displayTypes = [
  { 
    id: 'VNC', 
    label: 'VNC', 
    description: 'Virtual Network Computing - Widely compatible',
    features: ['Cross-platform support', 'Web browser access', 'Simple setup']
  },
  { 
    id: 'SPICE', 
    label: 'SPICE', 
    description: 'Simple Protocol for Independent Computing Environments',
    features: ['Better performance', 'USB passthrough', 'Audio support', 'Clipboard sync']
  },
];

export function EditDisplaySettingsModal({ isOpen, onClose, vm, onSave }: EditDisplaySettingsModalProps) {
  const [displayType, setDisplayType] = useState<'VNC' | 'SPICE'>('VNC');
  const [port, setPort] = useState<number | 'auto'>('auto');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [listen, setListen] = useState('0.0.0.0');
  const [enableClipboard, setEnableClipboard] = useState(true);
  const [enableAudio, setEnableAudio] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.display) {
      setDisplayType((vm.spec.display.type?.toUpperCase() as 'VNC' | 'SPICE') || 'VNC');
      setPort(vm.spec.display.port || 'auto');
      setPassword(vm.spec.display.password || '');
      setListen(vm.spec.display.listen || '0.0.0.0');
      setEnableClipboard(vm.spec.display.clipboard !== false);
      setEnableAudio(vm.spec.display.audio || false);
    }
  }, [vm]);

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(result);
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        type: displayType,
        port,
        password,
        listen,
        enableClipboard,
        enableAudio,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface">
            <h2 className="text-lg font-semibold text-text-primary">Display Settings</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Display Type */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Display Protocol
              </label>
              <div className="grid grid-cols-2 gap-3">
                {displayTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setDisplayType(type.id as 'VNC' | 'SPICE')}
                    className={cn(
                      'p-4 border rounded-lg text-left transition-all',
                      displayType === type.id
                        ? 'bg-accent/10 border-accent'
                        : 'bg-bg-base border-border hover:border-text-muted'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Monitor className={cn('w-4 h-4', displayType === type.id ? 'text-accent' : 'text-text-secondary')} />
                      <span className="font-medium text-text-primary">{type.label}</span>
                    </div>
                    <div className="text-xs text-text-muted mb-2">{type.description}</div>
                    <ul className="text-xs text-text-secondary space-y-1">
                      {type.features.map((feature, i) => (
                        <li key={i}>• {feature}</li>
                      ))}
                    </ul>
                  </button>
                ))}
              </div>
            </div>

            {/* Port */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Port
              </label>
              <div className="flex items-center gap-3">
                <select
                  value={port === 'auto' ? 'auto' : 'manual'}
                  onChange={(e) => setPort(e.target.value === 'auto' ? 'auto' : 5900)}
                  className="flex-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value="auto">Auto-assign</option>
                  <option value="manual">Manual</option>
                </select>
                {port !== 'auto' && (
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 5900)}
                    min={5900}
                    max={65535}
                    className="w-24 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                )}
              </div>
              <p className="text-xs text-text-muted mt-1">
                VNC typically uses ports 5900+. Auto-assign lets the hypervisor choose.
              </p>
            </div>

            {/* Listen Address */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Listen Address
              </label>
              <select
                value={listen}
                onChange={(e) => setListen(e.target.value)}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="127.0.0.1">Localhost only (127.0.0.1)</option>
                <option value="0.0.0.0">All interfaces (0.0.0.0)</option>
              </select>
              <p className="text-xs text-text-muted mt-1">
                Use localhost for local access only, all interfaces for remote access.
              </p>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Console Password
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave empty for no password"
                    className="w-full px-3 py-2 pr-10 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button variant="ghost" size="sm" onClick={generatePassword} title="Generate password">
                  <RefreshCw className="w-4 h-4" />
                </Button>
                {password && (
                  <Button variant="ghost" size="sm" onClick={copyPassword} title="Copy password">
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>

            {/* SPICE-specific options */}
            {displayType === 'SPICE' && (
              <div className="space-y-4 p-4 bg-bg-base rounded-lg border border-border">
                <h4 className="text-sm font-medium text-text-primary">SPICE Options</h4>
                
                <label className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-text-primary">Clipboard Sharing</span>
                    <p className="text-xs text-text-muted">Share clipboard between host and VM</p>
                  </div>
                  <ToggleSwitch
                    enabled={enableClipboard}
                    onChange={setEnableClipboard}
                  />
                </label>

                <label className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-text-primary">Audio Passthrough</span>
                    <p className="text-xs text-text-muted">Enable audio from the VM</p>
                  </div>
                  <ToggleSwitch
                    enabled={enableAudio}
                    onChange={setEnableAudio}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-bg-surface">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
