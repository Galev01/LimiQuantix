import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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

      <AnimatePresence mode="wait">
        {!collapsed && (
          <motion.span
            key={`label-${item.id}`}
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="flex-1 text-left truncate"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      {!collapsed && item.badge !== undefined && (
        <span className="px-1.5 py-0.5 text-xs rounded-md bg-accent/20 text-accent">
          {item.badge}
        </span>
      )}

      {!collapsed && hasChildren && (
        <motion.div animate={{ rotate: expanded ? 0 : -90 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="w-4 h-4 text-text-muted" />
        </motion.div>
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

      <AnimatePresence mode="wait">
        {hasChildren && expanded && !collapsed && (
          <motion.div
            key={`children-${item.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? 64 : 240 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={cn(
        'h-screen bg-sidebar border-r border-border',
        'flex flex-col shrink-0',
        'overflow-hidden',
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <Server className="w-8 h-8 text-accent" />
          <AnimatePresence mode="wait">
            {!sidebarCollapsed && (
              <motion.div
                key="logo-text"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="flex flex-col"
              >
                <span className="font-bold text-text-primary tracking-tight text-lg">Quantix</span>
                <span className="text-[10px] text-text-muted uppercase tracking-widest">
                  Host Manager
                </span>
              </motion.div>
            )}
          </AnimatePresence>
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
          <motion.div
            animate={{ rotate: sidebarCollapsed ? 0 : 180 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight className="w-4 h-4" />
          </motion.div>
          <AnimatePresence mode="wait">
            {!sidebarCollapsed && (
              <motion.span
                key="collapse-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
