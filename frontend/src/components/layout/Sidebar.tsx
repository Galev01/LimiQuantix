import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Server,
  HardDrive,
  Network,
  Database,
  Shield,
  Settings,
  ChevronRight,
  ChevronDown,
  MonitorCog,
  Boxes,
  FolderTree,
  Layers,
  Plus,
  FolderOpen,
  RefreshCw,
  Activity,
  Bell,
  Zap,
  Cloud,
  Scale,
  KeyRound,
  Radio,
} from 'lucide-react';
import QuantixLogo from '@/assets/Logo.png';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  badge?: number;
  children?: NavItem[];
  contextMenu?: boolean;
}

const navigation: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: FolderTree,
    children: [
      { id: 'vms', label: 'Virtual Machines', icon: MonitorCog, href: '/vms', badge: 6, contextMenu: true },
      { id: 'hosts', label: 'Hosts', icon: Server, href: '/hosts', badge: 4 },
      { id: 'clusters', label: 'Clusters', icon: Boxes, href: '/clusters' },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: Database,
    children: [
      { id: 'pools', label: 'Storage Pools', icon: Layers, href: '/storage/pools' },
      { id: 'volumes', label: 'Volumes', icon: HardDrive, href: '/storage/volumes' },
      { id: 'images', label: 'Image Library', icon: Cloud, href: '/storage/images' },
    ],
  },
  {
    id: 'networking',
    label: 'Networking',
    icon: Network,
    children: [
      { id: 'networks', label: 'Virtual Networks', icon: Network, href: '/networks' },
      { id: 'load-balancers', label: 'Load Balancers', icon: Scale, href: '/networks/load-balancers' },
      { id: 'vpn', label: 'VPN Services', icon: KeyRound, href: '/networks/vpn' },
      { id: 'bgp', label: 'BGP Speakers', icon: Radio, href: '/networks/bgp' },
      { id: 'security', label: 'Security Groups', icon: Shield, href: '/security' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Activity,
    children: [
      { id: 'monitoring', label: 'Monitoring', icon: Activity, href: '/monitoring' },
      { id: 'alerts', label: 'Alerts', icon: Bell, href: '/alerts', badge: 3 },
      { id: 'drs', label: 'DRS Recommendations', icon: Zap, href: '/drs' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  itemId: string | null;
}

interface NavItemProps {
  item: NavItem;
  collapsed: boolean;
  level?: number;
  onContextMenu?: (e: React.MouseEvent, itemId: string) => void;
}

function NavItemComponent({ item, collapsed, level = 0, onContextMenu }: NavItemProps) {
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

  const handleContextMenu = (e: React.MouseEvent) => {
    if (item.contextMenu && onContextMenu) {
      e.preventDefault();
      onContextMenu(e, item.id);
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

      <AnimatePresence>
        {!collapsed && (
          <motion.span
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
        <Link 
          to={item.href} 
          className={buttonClasses}
          onContextMenu={handleContextMenu}
        >
          {content}
        </Link>
      ) : (
        <button 
          onClick={handleClick} 
          className={buttonClasses}
          onContextMenu={handleContextMenu}
        >
          {content}
        </button>
      )}

      <AnimatePresence>
        {hasChildren && expanded && !collapsed && (
          <motion.div
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
                  onContextMenu={onContextMenu}
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
  const { sidebarCollapsed, toggleSidebar, openVmWizard } = useAppStore();
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    itemId: null,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      itemId,
    });
  };

  const handleCreateVM = () => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
    openVmWizard();
  };

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: sidebarCollapsed ? 64 : 260 }}
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
            <img 
              src={QuantixLogo} 
              alt="Quantix" 
              className="w-15 h-15 object-contain"
            />
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col"
                >
                  <span className="font-bold text-text-primary tracking-tight text-lg">Quantix</span>
                  <span className="text-[10px] text-text-muted uppercase tracking-widest">
                    Virtualization
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
              onContextMenu={handleContextMenu}
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
            <AnimatePresence>
              {!sidebarCollapsed && (
                <motion.span
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

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu.visible && contextMenu.itemId === 'vms' && (
          <motion.div
            ref={contextMenuRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className={cn(
              'fixed z-[100] min-w-[180px]',
              'bg-bg-surface border border-border rounded-lg shadow-xl',
              'py-1 overflow-hidden',
            )}
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            <button
              onClick={handleCreateVM}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Virtual Machine
            </button>
            <button
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              onClick={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
            >
              <FolderOpen className="w-4 h-4" />
              Browse VMs
            </button>
            <div className="my-1 border-t border-border" />
            <button
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              onClick={() => setContextMenu((prev) => ({ ...prev, visible: false }))}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
