import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  HardDrive,
  Network,
  Database,
  Settings,
  ChevronRight,
  ChevronDown,
  MonitorCog,
  Layers,
  Activity,
  List,
  Cpu,
  Box,
  ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/useAppStore';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  badge?: number;
  children?: NavItem[];
}

const navigation: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'vms', label: 'Virtual Machines', icon: MonitorCog, href: '/vms' },
  {
    id: 'storage',
    label: 'Storage',
    icon: Database,
    children: [
      { id: 'pools', label: 'Storage Pools', icon: Layers, href: '/storage/pools' },
      { id: 'volumes', label: 'Volumes', icon: HardDrive, href: '/storage/volumes' },
      { id: 'images', label: 'Images (ISO/OVA)', icon: Box, href: '/storage/images' },
    ],
  },
  { id: 'networking', label: 'Networking', icon: Network, href: '/networking' },
  { id: 'hardware', label: 'Hardware', icon: Cpu, href: '/hardware' },
  { id: 'monitor', label: 'Performance', icon: Activity, href: '/monitor' },
  { id: 'events', label: 'Events', icon: List, href: '/events' },
  { id: 'logs', label: 'System Logs', icon: ScrollText, href: '/logs' },
  { id: 'settings', label: 'Configuration', icon: Settings, href: '/settings' },
];

interface NavItemProps {
  item: NavItem;
  collapsed: boolean;
  level?: number;
}

function NavItemComponent({ item, collapsed, level = 0 }: NavItemProps) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(true);
  const hasChildren = item.children && item.children.length > 0;
  const Icon = item.icon;

  // Check if current route matches this item or any of its children
  const isActive = item.href
    ? location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href))
    : item.children?.some((child) => child.href && location.pathname.startsWith(child.href));

  const handleClick = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  const content = (
    <>
      <Icon
        className={cn(
          'w-[18px] h-[18px] shrink-0 transition-colors',
          isActive ? 'text-accent' : 'text-text-muted group-hover:text-accent',
        )}
      />

      {!collapsed && (
        <span className="flex-1 text-left truncate transition-opacity duration-200">
          {item.label}
        </span>
      )}

      {!collapsed && item.badge !== undefined && (
        <span className="px-1.5 py-0.5 text-xs rounded-md bg-accent/20 text-accent">
          {item.badge}
        </span>
      )}

      {!collapsed && hasChildren && (
        <div 
          className="transition-transform duration-150" 
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        >
          <ChevronDown className="w-4 h-4 text-text-muted" />
        </div>
      )}
    </>
  );

  const buttonClasses = cn(
    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
    'transition-all duration-150',
    'group relative',
    level > 0 && 'ml-4',
    isActive
      ? 'bg-accent/10 text-text-primary'
      : 'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover',
  );

  return (
    <div>
      {item.href && !hasChildren ? (
        <Link to={item.href} className={buttonClasses}>
          {content}
        </Link>
      ) : (
        <button onClick={handleClick} className={buttonClasses}>
          {content}
        </button>
      )}

      {hasChildren && !collapsed && (
        <div
          className={cn(
            'overflow-hidden transition-all duration-200',
            expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          )}
        >
          <div className="mt-1 space-y-0.5 border-l border-border ml-5 pl-2">
            {item.children!.map((child) => (
              <NavItemComponent
                key={child.id}
                item={child}
                collapsed={collapsed}
                level={level + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <aside
      style={{ width: sidebarCollapsed ? 64 : 240 }}
      className={cn(
        'h-screen bg-sidebar border-r border-border',
        'flex flex-col shrink-0',
        'overflow-hidden',
        'transition-[width] duration-200 ease-in-out',
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <Server className="w-8 h-8 text-accent" />
          {!sidebarCollapsed && (
            <div className="flex flex-col transition-opacity duration-200">
              <span className="font-bold text-text-primary tracking-tight text-lg">Quantix</span>
              <span className="text-[10px] text-text-muted uppercase tracking-widest">
                Host Manager
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => (
          <NavItemComponent
            key={item.id}
            item={item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Collapse Button */}
      <div className="p-3 border-t border-border">
        <button
          onClick={toggleSidebar}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg',
            'text-text-muted hover:text-text-primary',
            'hover:bg-sidebar-hover',
            'transition-all duration-150',
          )}
        >
          <div 
            className="transition-transform duration-200" 
            style={{ transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </div>
          {!sidebarCollapsed && (
            <span className="text-sm transition-opacity duration-200">
              Collapse
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
