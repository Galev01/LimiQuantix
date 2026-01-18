/**
 * LogComponentBadge - Visual badge for log source/component categorization
 * 
 * Displays a colored badge with icon indicating the log source component.
 */

import { 
  Monitor, 
  HardDrive, 
  Network, 
  Server, 
  Settings, 
  LayoutDashboard,
  Terminal,
  Shield,
  FileText,
  Download,
  Cog,
  Cpu,
  Key,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Component configuration with icon, color, and label
 */
interface ComponentStyle {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}

/**
 * Map of component/source names to their visual styles
 */
const COMPONENT_STYLES: Record<string, ComponentStyle> = {
  // Node daemon services
  'limiquantix-node': { icon: Server, color: 'text-blue-400', bgColor: 'bg-blue-400/10', label: 'Node Daemon' },
  'kernel': { icon: Cpu, color: 'text-red-400', bgColor: 'bg-red-400/10', label: 'Kernel' },
  'systemd': { icon: Settings, color: 'text-gray-400', bgColor: 'bg-gray-400/10', label: 'systemd' },
  'libvirtd': { icon: Monitor, color: 'text-orange-400', bgColor: 'bg-orange-400/10', label: 'libvirt' },
  'qemu': { icon: Monitor, color: 'text-teal-400', bgColor: 'bg-teal-400/10', label: 'QEMU' },
  'network': { icon: Network, color: 'text-purple-400', bgColor: 'bg-purple-400/10', label: 'Network' },
  'storage': { icon: HardDrive, color: 'text-amber-400', bgColor: 'bg-amber-400/10', label: 'Storage' },
  
  // UI components
  'ui-vm': { icon: Monitor, color: 'text-emerald-400', bgColor: 'bg-emerald-400/10', label: 'UI: VMs' },
  'ui-storage': { icon: HardDrive, color: 'text-amber-400', bgColor: 'bg-amber-400/10', label: 'UI: Storage' },
  'ui-network': { icon: Network, color: 'text-purple-400', bgColor: 'bg-purple-400/10', label: 'UI: Network' },
  'ui-host': { icon: Server, color: 'text-blue-400', bgColor: 'bg-blue-400/10', label: 'UI: Host' },
  'ui-settings': { icon: Cog, color: 'text-slate-400', bgColor: 'bg-slate-400/10', label: 'UI: Settings' },
  'ui-dashboard': { icon: LayoutDashboard, color: 'text-sky-400', bgColor: 'bg-sky-400/10', label: 'UI: Dashboard' },
  'ui-console': { icon: Terminal, color: 'text-green-400', bgColor: 'bg-green-400/10', label: 'UI: Console' },
  'ui-auth': { icon: Shield, color: 'text-red-400', bgColor: 'bg-red-400/10', label: 'UI: Auth' },
  'ui-logs': { icon: FileText, color: 'text-lime-400', bgColor: 'bg-lime-400/10', label: 'UI: Logs' },
  'ui-updates': { icon: Download, color: 'text-fuchsia-400', bgColor: 'bg-fuchsia-400/10', label: 'UI: Updates' },
  'ui-hardware': { icon: Cpu, color: 'text-cyan-400', bgColor: 'bg-cyan-400/10', label: 'UI: Hardware' },
  'ui-certificates': { icon: Key, color: 'text-pink-400', bgColor: 'bg-pink-400/10', label: 'UI: Certificates' },
  'ui-registration': { icon: UserPlus, color: 'text-teal-400', bgColor: 'bg-teal-400/10', label: 'UI: Registration' },
  
  // Default
  'default': { icon: FileText, color: 'text-text-muted', bgColor: 'bg-bg-elevated', label: 'System' },
};

/**
 * Get the style configuration for a component/source
 */
export function getComponentStyle(source: string | undefined): ComponentStyle {
  if (!source) return COMPONENT_STYLES['default'];
  
  // Try exact match first
  if (COMPONENT_STYLES[source]) {
    return COMPONENT_STYLES[source];
  }
  
  // Try lowercase match
  const lowerSource = source.toLowerCase();
  if (COMPONENT_STYLES[lowerSource]) {
    return COMPONENT_STYLES[lowerSource];
  }
  
  // Check if it's a UI action (starts with ui-)
  if (lowerSource.startsWith('ui-')) {
    const uiComponent = lowerSource;
    if (COMPONENT_STYLES[uiComponent]) {
      return COMPONENT_STYLES[uiComponent];
    }
  }
  
  return COMPONENT_STYLES['default'];
}

export interface LogComponentBadgeProps {
  /** The source/component name from the log entry */
  source: string | undefined;
  /** Whether to show the full label or just the icon */
  showLabel?: boolean;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional class names */
  className?: string;
}

/**
 * LogComponentBadge displays a visual indicator for the log source
 */
export function LogComponentBadge({ 
  source, 
  showLabel = false, 
  size = 'sm',
  className 
}: LogComponentBadgeProps) {
  const style = getComponentStyle(source);
  const Icon = style.icon;
  
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  
  return (
    <span 
      className={cn(
        'inline-flex items-center gap-1 rounded-md font-medium',
        style.bgColor,
        style.color,
        padding,
        textSize,
        className
      )}
      title={style.label}
    >
      <Icon className={iconSize} />
      {showLabel && <span>{style.label}</span>}
    </span>
  );
}

/**
 * LogComponentIcon - Just the icon without the badge styling
 */
export function LogComponentIcon({ 
  source, 
  className 
}: { 
  source: string | undefined; 
  className?: string;
}) {
  const style = getComponentStyle(source);
  const Icon = style.icon;
  
  return <Icon className={cn('w-4 h-4', style.color, className)} />;
}

/**
 * Get all unique component styles for legend display
 */
export function getAllComponentStyles(): Array<{ key: string; style: ComponentStyle }> {
  return Object.entries(COMPONENT_STYLES)
    .filter(([key]) => key !== 'default')
    .map(([key, style]) => ({ key, style }));
}

export default LogComponentBadge;
