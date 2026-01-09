import { useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useThemeStore } from '@/stores/theme-store';

export function Settings() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-muted mt-1">Configure your limiquantix platform</p>
        </div>
        <Button>
          <Save className="w-4 h-4" />
          Save All Changes
        </Button>
      </div>

      {/* Settings Tabs */}
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
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

