import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  User,
  Shield,
  Bell,
  Database,
  Network,
  Cpu,
  Key,
  Mail,
  Globe,
  Moon,
  Sun,
  Save,
  RefreshCw,
  AlertTriangle,
  Check,
  ChevronRight,
  Palette,
  Clock,
  HardDrive,
  Zap,
  Download,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
  Package,
  ArrowDownToLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useThemeStore } from '@/stores/theme-store';
import { useActionLogger } from '@/hooks/useActionLogger';
import {
  useVDCUpdateWithTracking,
  useCheckVDCUpdate,
  useApplyVDCUpdate,
  useHostsUpdateStatus,
  useCheckAllHostUpdates,
  useApplyHostUpdate,
  useUpdateConfig,
  useUpdateConfigMutation,
  getStatusColor,
  getStatusLabel,
  formatBytes,
  type HostUpdateInfo,
  type UpdateChannel,
} from '@/hooks/useUpdates';

export function Settings() {
  const logger = useActionLogger('settings');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-muted mt-1">Configure your limiquantix platform</p>
        </div>
        <Button
          logAction
          logComponent="settings"
          logTarget="save-all-changes"
        >
          <Save className="w-4 h-4" />
          Save All Changes
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs
        defaultValue="general"
        onChange={(value) => logger.logTabSwitch(value)}
      >
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="updates">
          <UpdateSettings />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceSettings />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>

        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>

        <TabsContent value="storage">
          <StorageSettings />
        </TabsContent>

        <TabsContent value="network">
          <NetworkSettings />
        </TabsContent>

        <TabsContent value="advanced">
          <AdvancedSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralSettings() {
  const [clusterName, setClusterName] = useState('limiquantix Production');
  const [timezone, setTimezone] = useState('America/New_York');
  const [language, setLanguage] = useState('en-US');

  return (
    <SettingsSection title="General Settings" description="Basic platform configuration">
      <div className="space-y-6">
        <SettingField label="Cluster Name" description="Display name for this limiquantix deployment">
          <input
            type="text"
            value={clusterName}
            onChange={(e) => setClusterName(e.target.value)}
            className="form-input max-w-md"
          />
        </SettingField>

        <SettingField label="Timezone" description="Default timezone for the platform">
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="form-select max-w-md"
          >
            <option value="America/New_York">America/New_York (EST)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="UTC">UTC</option>
          </select>
        </SettingField>

        <SettingField label="Language" description="Interface language">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="form-select max-w-md"
          >
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="de-DE">Deutsch</option>
            <option value="fr-FR">Français</option>
            <option value="ja-JP">日本語</option>
          </select>
        </SettingField>

        <SettingField label="Session Timeout" description="Automatic logout after inactivity">
          <select className="form-select max-w-md">
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="0">Never</option>
          </select>
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function UpdateSettings() {
  const logger = useActionLogger('updates');
  const { 
    data: vdcStatus, 
    isLoading: vdcLoading,
    updateResult,
    clearUpdateResult,
    isUpdateInProgress,
  } = useVDCUpdateWithTracking();
  const { data: hostsData, isLoading: hostsLoading } = useHostsUpdateStatus();
  const { data: config } = useUpdateConfig();
  
  const checkVDC = useCheckVDCUpdate();
  const applyVDC = useApplyVDCUpdate();
  const checkAllHosts = useCheckAllHostUpdates();
  const applyHost = useApplyHostUpdate();
  const updateConfigMutation = useUpdateConfigMutation();

  const [selectedChannel, setSelectedChannel] = useState<UpdateChannel>(config?.channel || 'dev');
  const [serverUrl, setServerUrl] = useState(config?.server_url || '');
  const [isEditingServerUrl, setIsEditingServerUrl] = useState(false);
  const lastUpdateCorrelationId = useRef<string | undefined>(undefined);
  const lastUpdateResultKey = useRef<string | undefined>(undefined);
  const lastStatusErrorKey = useRef<string | undefined>(undefined);

  // Sync state when config loads
  useEffect(() => {
    if (config) {
      setSelectedChannel(config.channel || 'dev');
      setServerUrl(config.server_url || '');
    }
  }, [config]);

  const hosts = hostsData?.hosts || [];
  const hostsWithUpdates = hosts.filter(h => h.status === 'available');

  const handleChannelChange = async (channel: UpdateChannel) => {
    setSelectedChannel(channel);
    logger.logSelect('update-channel', channel);
    try {
      await updateConfigMutation.mutateAsync({ channel });
      logger.logSuccess('update-channel', `Update channel set to ${channel}`, { channel, audit: true });
    } catch (error) {
      logger.logError('update-channel', error as Error, { channel, audit: true });
    }
  };

  const handleServerUrlSave = async () => {
    if (serverUrl.trim()) {
      const url = serverUrl.trim();
      logger.logSubmit('update-server-url', { server_url: url });
      try {
        await updateConfigMutation.mutateAsync({ server_url: url });
        logger.logSuccess('update-server-url', 'Update server URL saved', { server_url: url, audit: true });
        setIsEditingServerUrl(false);
      } catch (error) {
        logger.logError('update-server-url', error as Error, { server_url: url, audit: true });
      }
    }
  };

  const handleCheckVDC = async () => {
    logger.logClick('check-vdc-updates', { audit: true });
    try {
      const data = await checkVDC.mutateAsync();
      if (data.available_version) {
        logger.logSuccess('check-vdc-updates', 'Update available', {
          available_version: data.available_version,
          audit: true,
        });
      } else {
        logger.logSuccess('check-vdc-updates', 'No updates available', { audit: true });
      }
    } catch (error) {
      logger.logError('check-vdc-updates', error as Error, { audit: true });
    }
  };

  const handleApplyVDC = async () => {
    const correlationId = logger.generateCorrelationId();
    lastUpdateCorrelationId.current = correlationId;
    logger.logClick('apply-vdc-update', {
      correlationId,
      target_version: vdcStatus?.available_version,
      audit: true,
    });
    try {
      await applyVDC.mutateAsync();
      logger.logSuccess('apply-vdc-update', 'Update started', {
        correlationId,
        target_version: vdcStatus?.available_version,
        audit: true,
      });
    } catch (error) {
      logger.logError('apply-vdc-update', error as Error, {
        correlationId,
        target_version: vdcStatus?.available_version,
        audit: true,
      });
    }
  };

  const handleRetryUpdate = async () => {
    const correlationId = logger.generateCorrelationId();
    lastUpdateCorrelationId.current = correlationId;
    logger.logClick('retry-vdc-update', {
      correlationId,
      previous_error: updateResult?.error,
      audit: true,
    });
    clearUpdateResult();
    await handleApplyVDC();
  };

  const handleCheckAllHosts = async () => {
    logger.logClick('check-all-hosts', { audit: true });
    try {
      const data = await checkAllHosts.mutateAsync();
      logger.logSuccess('check-all-hosts', 'Host update check completed', {
        total: data.total,
        updates_available: data.updates_available,
        audit: true,
      });
    } catch (error) {
      logger.logError('check-all-hosts', error as Error, { audit: true });
    }
  };

  const handleApplyHost = async (host: HostUpdateInfo) => {
    logger.logClick('apply-host-update', {
      host_id: host.node_id,
      hostname: host.hostname,
      target_version: host.available_version,
      audit: true,
    });
    try {
      await applyHost.mutateAsync(host.node_id);
      logger.logSuccess('apply-host-update', `Update started on ${host.hostname}`, {
        host_id: host.node_id,
        hostname: host.hostname,
        target_version: host.available_version,
        audit: true,
      });
    } catch (error) {
      logger.logError('apply-host-update', error as Error, {
        host_id: host.node_id,
        hostname: host.hostname,
        audit: true,
      });
    }
  };

  const handleAutoCheckToggle = async (checked: boolean) => {
    logger.logToggle('auto-check-updates', checked);
    try {
      await updateConfigMutation.mutateAsync({ auto_check: checked });
      logger.logSuccess('auto-check-updates', `Auto check ${checked ? 'enabled' : 'disabled'}`, { audit: true });
    } catch (error) {
      logger.logError('auto-check-updates', error as Error, { audit: true });
    }
  };

  const handleAutoApplyToggle = async (checked: boolean) => {
    logger.logToggle('auto-apply-updates', checked);
    try {
      await updateConfigMutation.mutateAsync({ auto_apply: checked });
      logger.logSuccess('auto-apply-updates', `Auto apply ${checked ? 'enabled' : 'disabled'}`, { audit: true });
    } catch (error) {
      logger.logError('auto-apply-updates', error as Error, { audit: true });
    }
  };

  const handleDismissUpdateResult = () => {
    logger.logClick('dismiss-update-result', {
      result: updateResult?.success ? 'success' : 'error',
      version: updateResult?.version,
      audit: true,
    });
    clearUpdateResult();
  };

  useEffect(() => {
    if (!updateResult) return;
    const resultKey = `${updateResult.success}-${updateResult.version}-${updateResult.completedAt.toISOString()}`;
    if (lastUpdateResultKey.current === resultKey) return;

    lastUpdateResultKey.current = resultKey;

    if (updateResult.success) {
      logger.logSuccess('update-completed', `Update completed to v${updateResult.version}`, {
        version: updateResult.version,
        previous_version: updateResult.previousVersion,
        components: updateResult.components,
        correlationId: lastUpdateCorrelationId.current,
        audit: true,
      });
    } else if (updateResult.error) {
      logger.logError('update-completed', updateResult.error, {
        version: updateResult.version,
        previous_version: updateResult.previousVersion,
        components: updateResult.components,
        correlationId: lastUpdateCorrelationId.current,
        audit: true,
      });
    }
  }, [updateResult, logger]);

  useEffect(() => {
    if (!vdcStatus?.error) return;
    if (lastStatusErrorKey.current === vdcStatus.error) return;

    lastStatusErrorKey.current = vdcStatus.error;
    logger.logError('vdc-update-status', vdcStatus.error, {
      status: vdcStatus.status,
      audit: true,
    });
  }, [vdcStatus?.error, vdcStatus?.status, logger]);

  return (
    <div className="space-y-6">
      {/* vDC Update Section */}
      <SettingsSection title="Quantix-vDC Updates" description="Manage updates for the vDC control plane">
        <div className="space-y-6">
          {/* Current Version & Status */}
          <div className="p-4 rounded-lg bg-bg-base border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-lg bg-accent/10">
                  <Package className="w-6 h-6 text-accent" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">Quantix-vDC</p>
                  {isUpdateInProgress ? (
                    <p className="text-sm text-text-muted">
                      Updating to <span className="font-mono text-accent">v{vdcStatus?.available_version}</span>
                    </p>
                  ) : (
                    <div className="text-sm text-text-muted space-y-0.5">
                      <p>
                        Installed: <span className="font-mono font-medium text-text-secondary">{vdcStatus?.current_version || 'Unknown'}</span>
                      </p>
                      {vdcStatus?.manifest?.version && (
                        <p>
                          Latest available: <span className="font-mono font-medium text-text-secondary">{vdcStatus.manifest.version}</span>
                          {vdcStatus.current_version === vdcStatus.manifest.version && (
                            <span className="ml-2 text-success">(you're on the latest version)</span>
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {(() => {
                  // Check if there's actually a newer version available
                  // (frontend verification in case backend state is stale)
                  const hasNewerVersion = vdcStatus?.manifest?.version && 
                    vdcStatus.current_version !== vdcStatus.manifest.version &&
                    vdcStatus?.status === 'available';
                  
                  if (vdcLoading) {
                    return <Loader2 className="w-5 h-5 animate-spin text-text-muted" />;
                  }
                  if (isUpdateInProgress) {
                    return (
                      <Badge variant="warning">
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        Updating...
                      </Badge>
                    );
                  }
                  if (hasNewerVersion) {
                    return (
                      <Badge variant="success">
                        <ArrowDownToLine className="w-3 h-3 mr-1" />
                        Update available
                      </Badge>
                    );
                  }
                  if (vdcStatus?.status === 'error') {
                    return (
                      <Badge variant="error">
                        <XCircle className="w-3 h-3 mr-1" />
                        Error
                      </Badge>
                    );
                  }
                  return (
                    <Badge variant="default">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Up to date
                    </Badge>
                  );
                })()}
              </div>
            </div>

            {/* Progress Bar - Show during update */}
            {isUpdateInProgress && (
              <div className="mt-4 space-y-2">
                <ProgressBar
                  value={vdcStatus?.download_progress || 0}
                  showPercentage={true}
                  size="md"
                />
                {vdcStatus?.message && (
                  <p className="text-sm text-text-secondary">
                    {vdcStatus.message}
                  </p>
                )}
                <p className="text-xs text-text-muted mt-2">
                  Please do not close this page while the update is in progress.
                </p>
              </div>
            )}
          </div>

          {/* Update Result Card - Shows after completion until dismissed */}
            {updateResult && (
            <div className={cn(
              "p-4 rounded-lg border",
              updateResult.success 
                ? "bg-success/10 border-success/30" 
                : "bg-error/10 border-error/30"
            )}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {updateResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-2">
                    <p className={cn(
                      "font-medium",
                      updateResult.success ? "text-success" : "text-error"
                    )}>
                      {updateResult.success 
                        ? `Successfully updated to v${updateResult.version}` 
                        : "Update Failed"}
                    </p>
                    
                    {updateResult.success && (
                      <div className="space-y-1">
                        <p className="text-sm text-text-secondary">
                          Updated from v{updateResult.previousVersion} to v{updateResult.version}
                        </p>
                        <div className="text-sm text-text-muted">
                          <span className="font-medium">Components updated:</span>
                          <ul className="mt-1 ml-4 list-disc">
                            {updateResult.components.map((component) => (
                              <li key={component}>{component}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    
                    {!updateResult.success && updateResult.error && (
                      <p className="text-sm text-text-secondary">{updateResult.error}</p>
                    )}
                    
                    <p className="text-xs text-text-muted">
                      Completed at {updateResult.completedAt.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismissUpdateResult}
                  className="shrink-0"
                >
                  Dismiss
                </Button>
              </div>
              
              {/* Progress bar at 100% for success */}
              {updateResult.success && (
                <div className="mt-4">
                  <ProgressBar
                    value={100}
                    showPercentage={false}
                    size="sm"
                    variant="success"
                  />
                </div>
              )}
            </div>
          )}

          {/* Update Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleCheckVDC}
              disabled={checkVDC.isPending || isUpdateInProgress}
            >
              {checkVDC.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Check for Updates
            </Button>
            {/* Only show Apply Update if there's actually a newer version */}
            {vdcStatus?.status === 'available' && 
             !isUpdateInProgress && 
             vdcStatus?.manifest?.version && 
             vdcStatus.current_version !== vdcStatus.manifest.version && (
              <Button
                onClick={handleApplyVDC}
                disabled={applyVDC.isPending}
              >
                {applyVDC.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Apply Update
              </Button>
            )}
            {!updateResult?.success && updateResult?.error && (
              <Button
                variant="secondary"
                onClick={handleRetryUpdate}
                disabled={applyVDC.isPending}
              >
                <RefreshCw className="w-4 h-4" />
                Retry Update
              </Button>
            )}
          </div>

          {/* Release Notes */}
          {vdcStatus?.manifest?.release_notes && !isUpdateInProgress && !updateResult && (
            <div className="p-4 rounded-lg bg-bg-base border border-border">
              <h4 className="font-medium text-text-primary mb-2">Release Notes</h4>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                {vdcStatus.manifest.release_notes}
              </p>
            </div>
          )}

          {/* Error Display (from backend status) */}
          {vdcStatus?.error && !updateResult && (
            <div className="p-4 rounded-lg bg-error/10 border border-error/30">
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-error">Update Error</p>
                  <p className="text-sm text-text-secondary">{vdcStatus.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Host Updates Section */}
      <SettingsSection title="QHCI Host Updates" description="Manage updates for connected Quantix-OS hosts">
        <div className="space-y-6">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-muted">
                {hosts.length} host(s) connected
                {hostsWithUpdates.length > 0 && (
                  <span className="text-success ml-2">
                    • {hostsWithUpdates.length} update(s) available
                  </span>
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleCheckAllHosts}
              disabled={checkAllHosts.isPending}
            >
              {checkAllHosts.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Check All Hosts
            </Button>
          </div>

          {/* Host List */}
          <div className="space-y-2">
            {hostsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
              </div>
            ) : hosts.length === 0 ? (
              <div className="py-8 text-center">
                <Server className="w-8 h-8 mx-auto text-text-muted mb-2" />
                <p className="text-sm text-text-muted">No connected hosts</p>
                <p className="text-xs text-text-muted mt-1">
                  Only hosts with "Ready" status are shown here.
                  <br />
                  Check the Hosts page to see all hosts including disconnected ones.
                </p>
              </div>
            ) : (
              hosts.map((host) => (
                <HostUpdateCard
                  key={host.node_id}
                  host={host}
                  onApply={() => handleApplyHost(host)}
                  isApplying={applyHost.isPending}
                />
              ))
            )}
          </div>
        </div>
      </SettingsSection>

      {/* Update Configuration */}
      <SettingsSection title="Update Configuration" description="Configure automatic update behavior">
        <div className="space-y-6">
          <SettingField label="Update Channel" description="Choose which release channel to follow">
            <div className="flex gap-3">
              {(['stable', 'beta', 'dev'] as UpdateChannel[]).map((channel) => (
                <button
                  key={channel}
                  onClick={() => handleChannelChange(channel)}
                  className={cn(
                    'px-4 py-2 rounded-lg border transition-all capitalize',
                    selectedChannel === channel
                      ? 'bg-accent/10 border-accent text-accent'
                      : 'bg-bg-base border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
                  )}
                >
                  {channel}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-muted mt-2">
              {selectedChannel === 'stable' && 'Production-ready releases. Recommended for most users.'}
              {selectedChannel === 'beta' && 'Feature-complete releases in testing phase.'}
              {selectedChannel === 'dev' && 'Latest development builds. May be unstable.'}
            </p>
          </SettingField>

          <SettingField label="Update Server" description="URL of the update server">
            <div className="flex gap-2 items-center max-w-lg">
              <input
                type="text"
                className={cn(
                  'form-input flex-1 font-mono text-sm',
                  isEditingServerUrl ? 'bg-bg-base' : 'bg-bg-elevated'
                )}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                onFocus={() => {
                  setIsEditingServerUrl(true);
                  logger.logClick('edit-update-server-url');
                }}
                placeholder="http://update-server:9000"
              />
              {isEditingServerUrl && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleServerUrlSave}
                    disabled={updateConfigMutation.isPending || !serverUrl.trim()}
                  >
                    {updateConfigMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setServerUrl(config?.server_url || '');
                      setIsEditingServerUrl(false);
                      logger.logClick('cancel-update-server-url', { audit: true });
                    }}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </SettingField>

          <SettingField label="Auto Check" description="Automatically check for updates periodically">
            <ToggleSwitch 
              checked={config?.auto_check ?? true} 
              onChange={handleAutoCheckToggle} 
            />
          </SettingField>

          <SettingField label="Auto Apply" description="Automatically apply component updates (no reboot required)">
            <ToggleSwitch 
              checked={config?.auto_apply ?? false} 
              onChange={handleAutoApplyToggle} 
            />
          </SettingField>
        </div>
      </SettingsSection>
    </div>
  );
}

function HostUpdateCard({
  host,
  onApply,
  isApplying,
}: {
  host: HostUpdateInfo;
  onApply: () => void;
  isApplying: boolean;
}) {
  const statusIcon = {
    idle: <CheckCircle2 className="w-4 h-4 text-success" />,
    checking: <Loader2 className="w-4 h-4 animate-spin text-info" />,
    available: <ArrowDownToLine className="w-4 h-4 text-success" />,
    downloading: <Loader2 className="w-4 h-4 animate-spin text-info" />,
    applying: <Loader2 className="w-4 h-4 animate-spin text-info" />,
    reboot_required: <AlertTriangle className="w-4 h-4 text-warning" />,
    error: <XCircle className="w-4 h-4 text-error" />,
  };

  // Show version or fallback text
  const versionDisplay = host.current_version ? `v${host.current_version}` : 'version unknown';

  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-bg-base border border-border">
      <div className="flex items-center gap-4">
        <div className="p-2 rounded-lg bg-bg-elevated">
          <Server className="w-5 h-5 text-text-muted" />
        </div>
        <div>
          <p className="font-medium text-text-primary">{host.hostname}</p>
          <p className="text-xs text-text-muted">
            {host.management_ip} • {versionDisplay}
          </p>
          {/* Show error message if status is error */}
          {host.status === 'error' && host.error && (
            <p className="text-xs text-error mt-1 max-w-md truncate" title={host.error}>
              {host.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {statusIcon[host.status]}
          <span className={cn('text-sm', getStatusColor(host.status))}>
            {host.status === 'available' && host.available_version
              ? `v${host.available_version} available`
              : getStatusLabel(host.status)}
          </span>
        </div>
        {host.status === 'available' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onApply}
            disabled={isApplying}
          >
            {isApplying ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            Update
          </Button>
        )}
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore();
  const [accentColor, setAccentColor] = useState('blue');
  const [compactMode, setCompactMode] = useState(false);

  const accentColors = [
    { id: 'blue', color: '#5c9cf5' },
    { id: 'purple', color: '#a78bfa' },
    { id: 'green', color: '#4ade80' },
    { id: 'orange', color: '#fb923c' },
    { id: 'pink', color: '#f472b6' },
    { id: 'cyan', color: '#22d3ee' },
  ];

  return (
    <SettingsSection title="Appearance" description="Customize the look and feel">
      <div className="space-y-6">
        <SettingField label="Theme" description="Choose your preferred color scheme">
          <div className="flex gap-3">
            {[
              { id: 'dark' as const, icon: Moon, label: 'Dark' },
              { id: 'light' as const, icon: Sun, label: 'Light' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg border transition-all',
                  theme === t.id
                    ? 'bg-accent/10 border-accent text-accent'
                    : 'bg-bg-base border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
                )}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </SettingField>

        <SettingField label="Accent Color" description="Primary color for buttons and highlights">
          <div className="flex gap-3">
            {accentColors.map((c) => (
              <button
                key={c.id}
                onClick={() => setAccentColor(c.id)}
                className={cn(
                  'w-10 h-10 rounded-lg transition-all',
                  accentColor === c.id && 'ring-2 ring-offset-2 ring-offset-bg-surface'
                )}
                style={{ backgroundColor: c.color, '--tw-ring-color': c.color } as React.CSSProperties}
              >
                {accentColor === c.id && <Check className="w-5 h-5 text-white mx-auto" />}
              </button>
            ))}
          </div>
        </SettingField>

        <SettingField label="Compact Mode" description="Reduce spacing for more content density">
          <ToggleSwitch checked={compactMode} onChange={setCompactMode} />
        </SettingField>

        <SettingField label="Animations" description="Enable UI animations and transitions">
          <ToggleSwitch checked={true} onChange={() => {}} />
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function NotificationSettings() {
  return (
    <SettingsSection title="Notifications" description="Configure alerts and notifications">
      <div className="space-y-6">
        <SettingField label="Email Notifications" description="Receive alerts via email">
          <ToggleSwitch checked={true} onChange={() => {}} />
        </SettingField>

        <SettingField label="Email Address" description="Where to send notification emails">
          <input
            type="email"
            placeholder="admin@company.com"
            className="form-input max-w-md"
            defaultValue="admin@limiquantix.local"
          />
        </SettingField>

        <div className="p-4 rounded-lg bg-bg-base border border-border">
          <h4 className="font-medium text-text-primary mb-4">Notification Types</h4>
          <div className="space-y-3">
            <NotificationToggle label="VM State Changes" description="Start, stop, crash events" defaultChecked />
            <NotificationToggle label="Host Alerts" description="CPU, memory, disk thresholds" defaultChecked />
            <NotificationToggle label="Storage Alerts" description="Pool capacity warnings" defaultChecked />
            <NotificationToggle label="Cluster Events" description="HA, DRS, failover events" defaultChecked />
            <NotificationToggle label="Security Alerts" description="Login failures, permission changes" defaultChecked />
            <NotificationToggle label="Backup Status" description="Success/failure notifications" />
          </div>
        </div>

        <SettingField label="Alert Severity Filter" description="Minimum severity for notifications">
          <select className="form-select max-w-md">
            <option value="info">Info and above</option>
            <option value="warning">Warning and above</option>
            <option value="error">Errors only</option>
          </select>
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function SecuritySettings() {
  return (
    <SettingsSection title="Security" description="Authentication and access control">
      <div className="space-y-6">
        <SettingField label="Two-Factor Authentication" description="Require 2FA for all users">
          <ToggleSwitch checked={false} onChange={() => {}} />
        </SettingField>

        <SettingField label="Password Policy" description="Minimum password requirements">
          <select className="form-select max-w-md">
            <option value="basic">Basic (8+ characters)</option>
            <option value="medium">Medium (12+ chars, mixed case, numbers)</option>
            <option value="strong">Strong (16+ chars, special characters)</option>
          </select>
        </SettingField>

        <SettingField label="Session Management" description="Active sessions and devices">
          <div className="space-y-2 max-w-lg">
            <SessionItem device="Chrome on macOS" location="New York, US" current />
            <SessionItem device="Firefox on Windows" location="London, UK" />
            <SessionItem device="Safari on iPhone" location="New York, US" />
          </div>
        </SettingField>

        <SettingField label="API Keys" description="Manage API access tokens">
          <Button variant="secondary">
            <Key className="w-4 h-4" />
            Manage API Keys
          </Button>
        </SettingField>

        <SettingField label="Audit Log Retention" description="How long to keep audit logs">
          <select className="form-select max-w-md">
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
            <option value="0">Forever</option>
          </select>
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function StorageSettings() {
  return (
    <SettingsSection title="Storage" description="Default storage configuration">
      <div className="space-y-6">
        <SettingField label="Default Storage Pool" description="Where new VMs are created">
          <select className="form-select max-w-md">
            <option value="ceph-ssd">Ceph SSD Pool (Production)</option>
            <option value="ceph-hdd">Ceph HDD Pool (Archive)</option>
            <option value="local-nvme">Local NVMe (High Performance)</option>
          </select>
        </SettingField>

        <SettingField label="Default Provisioning" description="Disk provisioning type">
          <div className="flex gap-3">
            <button className="flex-1 max-w-[200px] p-3 rounded-lg border bg-accent/10 border-accent text-accent">
              <Zap className="w-5 h-5 mx-auto mb-1" />
              <p className="text-sm font-medium">Thin</p>
              <p className="text-xs opacity-80">Allocate on demand</p>
            </button>
            <button className="flex-1 max-w-[200px] p-3 rounded-lg border border-border text-text-secondary hover:border-border-hover">
              <HardDrive className="w-5 h-5 mx-auto mb-1" />
              <p className="text-sm font-medium">Thick</p>
              <p className="text-xs opacity-80">Pre-allocate space</p>
            </button>
          </div>
        </SettingField>

        <SettingField label="Storage Overcommit" description="Allow overprovisioning of storage">
          <ToggleSwitch checked={true} onChange={() => {}} />
        </SettingField>

        <SettingField label="Snapshot Retention" description="Default snapshot cleanup policy">
          <select className="form-select max-w-md">
            <option value="7">Keep for 7 days</option>
            <option value="14">Keep for 14 days</option>
            <option value="30">Keep for 30 days</option>
            <option value="0">Keep forever</option>
          </select>
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function NetworkSettings() {
  return (
    <SettingsSection title="Network" description="Network configuration defaults">
      <div className="space-y-6">
        <SettingField label="Default Network" description="Network for new VMs">
          <select className="form-select max-w-md">
            <option value="prod-100">Production VLAN 100</option>
            <option value="dev-200">Development VLAN 200</option>
            <option value="mgmt">Management Network</option>
          </select>
        </SettingField>

        <SettingField label="Default Security Group" description="Firewall rules for new VMs">
          <select className="form-select max-w-md">
            <option value="default">default (allow outbound only)</option>
            <option value="web-servers">web-servers</option>
            <option value="database-servers">database-servers</option>
          </select>
        </SettingField>

        <SettingField label="DNS Servers" description="Default DNS for DHCP">
          <input
            type="text"
            placeholder="8.8.8.8, 8.8.4.4"
            className="form-input max-w-md"
            defaultValue="10.0.0.2, 10.0.0.3"
          />
        </SettingField>

        <SettingField label="NTP Servers" description="Time synchronization servers">
          <input
            type="text"
            placeholder="pool.ntp.org"
            className="form-input max-w-md"
            defaultValue="ntp.limiquantix.local"
          />
        </SettingField>

        <SettingField label="MTU" description="Default MTU for virtual networks">
          <select className="form-select max-w-md">
            <option value="1500">1500 (Standard)</option>
            <option value="9000">9000 (Jumbo Frames)</option>
            <option value="1400">1400 (Overlay)</option>
          </select>
        </SettingField>
      </div>
    </SettingsSection>
  );
}

function AdvancedSettings() {
  return (
    <SettingsSection title="Advanced" description="Expert settings - modify with caution">
      <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-warning">Warning</p>
            <p className="text-sm text-text-secondary">
              These settings can affect system stability. Only modify if you understand the implications.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <SettingField label="CPU Overcommit Ratio" description="Maximum CPU allocation ratio">
          <select className="form-select max-w-md">
            <option value="1">1:1 (No overcommit)</option>
            <option value="2">2:1</option>
            <option value="4">4:1</option>
            <option value="8">8:1</option>
          </select>
        </SettingField>

        <SettingField label="Memory Overcommit" description="Allow memory overprovisioning">
          <ToggleSwitch checked={false} onChange={() => {}} />
        </SettingField>

        <SettingField label="VM Migration Timeout" description="Max time for live migration (seconds)">
          <input
            type="number"
            className="form-input max-w-md"
            defaultValue="600"
            min="60"
            max="3600"
          />
        </SettingField>

        <SettingField label="Agent Heartbeat Interval" description="How often agents report health (seconds)">
          <input
            type="number"
            className="form-input max-w-md"
            defaultValue="30"
            min="10"
            max="300"
          />
        </SettingField>

        <SettingField label="Debug Mode" description="Enable verbose logging">
          <ToggleSwitch checked={false} onChange={() => {}} />
        </SettingField>

        <div className="pt-4 border-t border-border">
          <h4 className="font-medium text-text-primary mb-4">Maintenance</h4>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary">
              <RefreshCw className="w-4 h-4" />
              Restart Services
            </Button>
            <Button variant="secondary">
              <Database className="w-4 h-4" />
              Clear Cache
            </Button>
            <Button variant="danger">
              <AlertTriangle className="w-4 h-4" />
              Factory Reset
            </Button>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

// Helper Components

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-bg-surface border border-border"
    >
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <p className="text-sm text-text-muted">{description}</p>
      </div>
      {children}
    </motion.div>
  );
}

function SettingField({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-start gap-4">
      <div className="md:w-1/3">
        <p className="font-medium text-text-primary">{label}</p>
        <p className="text-sm text-text-muted">{description}</p>
      </div>
      <div className="md:flex-1">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-bg-elevated'
      )}
    >
      <motion.div
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow"
      />
    </button>
  );
}

function NotificationToggle({
  label,
  description,
  defaultChecked = false,
}: {
  label: string;
  description: string;
  defaultChecked?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={setChecked} />
    </div>
  );
}

function SessionItem({
  device,
  location,
  current = false,
}: {
  device: string;
  location: string;
  current?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-bg-base">
      <div>
        <p className="text-sm font-medium text-text-primary">
          {device}
          {current && <Badge variant="success" className="ml-2">Current</Badge>}
        </p>
        <p className="text-xs text-text-muted">{location}</p>
      </div>
      {!current && (
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      )}
    </div>
  );
}

