/**
 * EditHAPolicyModal - Edit VM High Availability policy
 * 
 * Allows editing HA restart priority, isolation response, and failover settings.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, AlertTriangle, RefreshCw, Loader2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type ApiVM } from '@/hooks/useVMs';

interface EditHAPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  onSave: (policy: HAPolicy) => Promise<void>;
}

interface HAPolicy {
  enabled: boolean;
  restartPriority: 'highest' | 'high' | 'medium' | 'low' | 'lowest';
  isolationResponse: 'none' | 'shutdown' | 'powerOff';
  vmMonitoring: 'disabled' | 'vmMonitoringOnly' | 'vmAndAppMonitoring';
  maxRestarts: number;
  restartPeriodMinutes: number;
}

const restartPriorities = [
  { value: 'highest', label: 'Highest', description: 'Restart first during failover', color: 'text-red-400' },
  { value: 'high', label: 'High', description: 'Restart early during failover', color: 'text-orange-400' },
  { value: 'medium', label: 'Medium', description: 'Default priority', color: 'text-yellow-400' },
  { value: 'low', label: 'Low', description: 'Restart later during failover', color: 'text-blue-400' },
  { value: 'lowest', label: 'Lowest', description: 'Restart last during failover', color: 'text-text-muted' },
];

const isolationResponses = [
  { 
    value: 'none', 
    label: 'Leave Powered On', 
    description: 'Do nothing when host becomes isolated',
    icon: '🔓'
  },
  { 
    value: 'shutdown', 
    label: 'Graceful Shutdown', 
    description: 'Send shutdown signal to guest OS',
    icon: '⚡'
  },
  { 
    value: 'powerOff', 
    label: 'Power Off', 
    description: 'Immediately power off the VM',
    icon: '🔌'
  },
];

const monitoringOptions = [
  { 
    value: 'disabled', 
    label: 'Disabled', 
    description: 'No heartbeat monitoring'
  },
  { 
    value: 'vmMonitoringOnly', 
    label: 'VM Monitoring', 
    description: 'Restart if VMware Tools heartbeat is lost'
  },
  { 
    value: 'vmAndAppMonitoring', 
    label: 'VM and Application Monitoring', 
    description: 'Also monitor application heartbeats'
  },
];

export function EditHAPolicyModal({ isOpen, onClose, vm, onSave }: EditHAPolicyModalProps) {
  const [enabled, setEnabled] = useState(true);
  const [restartPriority, setRestartPriority] = useState<HAPolicy['restartPriority']>('medium');
  const [isolationResponse, setIsolationResponse] = useState<HAPolicy['isolationResponse']>('shutdown');
  const [vmMonitoring, setVmMonitoring] = useState<HAPolicy['vmMonitoring']>('vmMonitoringOnly');
  const [maxRestarts, setMaxRestarts] = useState(3);
  const [restartPeriodMinutes, setRestartPeriodMinutes] = useState(60);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.ha) {
      setEnabled(vm.spec.ha.enabled !== false);
      setRestartPriority((vm.spec.ha.restartPriority as HAPolicy['restartPriority']) || 'medium');
      setIsolationResponse((vm.spec.ha.isolationResponse as HAPolicy['isolationResponse']) || 'shutdown');
      setVmMonitoring((vm.spec.ha.vmMonitoring as HAPolicy['vmMonitoring']) || 'vmMonitoringOnly');
      setMaxRestarts(vm.spec.ha.maxRestarts || 3);
      setRestartPeriodMinutes(vm.spec.ha.restartPeriodMinutes || 60);
    }
  }, [vm]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        enabled,
        restartPriority,
        isolationResponse,
        vmMonitoring,
        maxRestarts,
        restartPeriodMinutes,
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
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-text-primary">High Availability Policy</h2>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Enable HA */}
            <div className="flex items-center justify-between p-4 bg-bg-base rounded-lg border border-border">
              <div className="flex items-center gap-3">
                <Shield className={cn('w-5 h-5', enabled ? 'text-green-400' : 'text-text-muted')} />
                <div>
                  <span className="text-sm font-medium text-text-primary">HA Protection</span>
                  <p className="text-xs text-text-muted">
                    Automatically restart this VM if the host fails
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  'w-12 h-6 rounded-full transition-colors relative',
                  enabled ? 'bg-green-500' : 'bg-bg-elevated border border-border'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            {enabled && (
              <>
                {/* Restart Priority */}
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Restart Priority
                  </label>
                  <p className="text-xs text-text-muted mb-3">
                    Higher priority VMs are restarted first during failover
                  </p>
                  <div className="space-y-2">
                    {restartPriorities.map((priority) => (
                      <button
                        key={priority.value}
                        onClick={() => setRestartPriority(priority.value as HAPolicy['restartPriority'])}
                        className={cn(
                          'w-full flex items-center justify-between p-3 border rounded-lg transition-all',
                          restartPriority === priority.value
                            ? 'bg-accent/10 border-accent'
                            : 'bg-bg-base border-border hover:border-text-muted'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span className={cn('font-medium', priority.color)}>{priority.label}</span>
                          <span className="text-xs text-text-muted">{priority.description}</span>
                        </div>
                        {restartPriority === priority.value && (
                          <Badge variant="default" size="sm" className="bg-accent/20 text-accent border-accent/30">
                            Selected
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Isolation Response */}
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Host Isolation Response
                  </label>
                  <p className="text-xs text-text-muted mb-3">
                    Action when the host loses network connectivity
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {isolationResponses.map((response) => (
                      <button
                        key={response.value}
                        onClick={() => setIsolationResponse(response.value as HAPolicy['isolationResponse'])}
                        className={cn(
                          'p-3 border rounded-lg text-center transition-all',
                          isolationResponse === response.value
                            ? 'bg-accent/10 border-accent'
                            : 'bg-bg-base border-border hover:border-text-muted'
                        )}
                      >
                        <div className="text-2xl mb-1">{response.icon}</div>
                        <div className="text-xs font-medium text-text-primary">{response.label}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted mt-2">
                    {isolationResponses.find(r => r.value === isolationResponse)?.description}
                  </p>
                </div>

                {/* VM Monitoring */}
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    VM Monitoring
                  </label>
                  <select
                    value={vmMonitoring}
                    onChange={(e) => setVmMonitoring(e.target.value as HAPolicy['vmMonitoring'])}
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    {monitoringOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-text-muted mt-1">
                    {monitoringOptions.find(o => o.value === vmMonitoring)?.description}
                  </p>
                </div>

                {/* Restart Limits */}
                {vmMonitoring !== 'disabled' && (
                  <div className="p-4 bg-bg-base rounded-lg border border-border space-y-4">
                    <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Restart Limits
                    </h4>

                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        Maximum Restarts
                      </label>
                      <input
                        type="number"
                        value={maxRestarts}
                        onChange={(e) => setMaxRestarts(parseInt(e.target.value) || 1)}
                        min={1}
                        max={10}
                        className="w-full px-3 py-2 bg-bg-elevated border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        Within Time Period (minutes)
                      </label>
                      <input
                        type="number"
                        value={restartPeriodMinutes}
                        onChange={(e) => setRestartPeriodMinutes(parseInt(e.target.value) || 60)}
                        min={15}
                        max={1440}
                        className="w-full px-3 py-2 bg-bg-elevated border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </div>

                    <p className="text-xs text-text-muted">
                      VM will be restarted at most {maxRestarts} time{maxRestarts !== 1 ? 's' : ''} within {restartPeriodMinutes} minutes
                    </p>
                  </div>
                )}

                {/* Info box */}
                <div className="flex items-start gap-3 p-4 bg-accent/10 rounded-lg border border-accent/30">
                  <Info className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-text-secondary">
                    <p className="font-medium text-text-primary mb-1">HA Cluster Required</p>
                    <p>
                      High Availability features require the VM to run on a host that is part of an HA cluster.
                      If the host is not in a cluster, these settings will be stored but not enforced.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-bg-surface">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Policy
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
