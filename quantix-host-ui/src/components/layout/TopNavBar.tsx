import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Server,
  HardDrive,
  Network,
  Database,
  Settings,
  ChevronDown,
  MonitorCog,
  Layers,
  Activity,
  Cpu,
  Box,
  ScrollText,
  Search,
  X,
  List,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/useAppStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { setNodeConnection } from '@/api/client';

// =============================================================================
// Types
// =============================================================================

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  badge?: number;
  children?: NavItem[];
}

interface TopNavBarProps {
  connectionInfo?: {
    url: string;
    name?: string;
  } | null;
}

// =============================================================================
// Navigation Structure (Simpler than vDC)
// =============================================================================

const navigation: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { id: 'vms', label: 'VMs', icon: MonitorCog, href: '/vms' },
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
  { id: 'logs', label: 'Logs', icon: ScrollText, href: '/logs' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];

// =============================================================================
// Dropdown Menu Component (Simple, no nested submenus)
// =============================================================================

interface DropdownMenuProps {
  items: NavItem[];
  isOpen: boolean;
  onClose: () => void;
}

function DropdownMenu({ items, isOpen, onClose }: DropdownMenuProps) {
  const location = useLocation();

  const isActive = (item: NavItem): boolean => {
    if (item.href) {
      return location.pathname === item.href || 
        (item.href !== '/' && location.pathname.startsWith(item.href.split('?')[0]));
    }
    return false;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn(
            'absolute z-50 min-w-[200px] top-full left-0 mt-1',
            'bg-bg-surface border border-border rounded-lg',
            'shadow-floating py-1.5',
            'backdrop-blur-sm',
          )}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);

            return (
              <Link
                key={item.id}
                to={item.href || '/'}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 mx-1.5 rounded-md',
                  'text-sm transition-all duration-150',
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-xs rounded-md bg-accent/20 text-accent">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// Nav Item Component
// =============================================================================

interface NavItemComponentProps {
  item: NavItem;
  openDropdown: string | null;
  setOpenDropdown: (id: string | null) => void;
}

function NavItemComponent({ item, openDropdown, setOpenDropdown }: NavItemComponentProps) {
  const location = useLocation();
  const hasChildren = item.children && item.children.length > 0;
  const Icon = item.icon;
  const isOpen = openDropdown === item.id;
  const itemRef = useRef<HTMLDivElement>(null);

  const isActive = item.href
    ? location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href))
    : item.children?.some((child) =>
        child.href && (location.pathname === child.href || location.pathname.startsWith(child.href.split('?')[0]))
      );

  const handleClick = () => {
    if (hasChildren) {
      setOpenDropdown(isOpen ? null : item.id);
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
      <span className="text-sm font-medium">{item.label}</span>
      {hasChildren && (
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        </motion.div>
      )}
    </>
  );

  const buttonClasses = cn(
    'flex items-center gap-2 px-3 py-2 rounded-lg',
    'transition-all duration-150',
    'group relative',
    isActive
      ? 'bg-accent/10 text-text-primary'
      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
  );

  return (
    <div ref={itemRef} className="relative">
      {item.href && !hasChildren ? (
        <Link to={item.href} className={buttonClasses}>
          {content}
        </Link>
      ) : (
        <button onClick={handleClick} className={buttonClasses}>
          {content}
        </button>
      )}

      {hasChildren && (
        <DropdownMenu
          items={item.children!}
          isOpen={isOpen}
          onClose={() => setOpenDropdown(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Search Bar Component
// =============================================================================

interface SearchBarProps {
  isOpen: boolean;
  onToggle: () => void;
  query: string;
  onQueryChange: (query: string) => void;
}

function SearchBar({ isOpen, onToggle, query, onQueryChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onToggle();
      }
      if (e.key === 'Escape' && isOpen) {
        onToggle();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onToggle]);

  return (
    <div className="relative flex items-center">
      <AnimatePresence mode="wait">
        {isOpen ? (
          <motion.div
            key="search-input"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative overflow-hidden"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search VMs..."
              className={cn(
                'w-full pl-9 pr-8 py-2 rounded-lg',
                'bg-bg-base border border-border',
                'text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                'transition-all duration-150',
              )}
            />
            <button
              onClick={onToggle}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-bg-hover"
            >
              <X className="w-3.5 h-3.5 text-text-muted" />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="search-icon"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onToggle}
            className={cn(
              'flex items-center gap-2 p-2 rounded-lg',
              'text-text-muted hover:text-text-primary',
              'hover:bg-bg-hover',
              'transition-all duration-150',
            )}
            title="Search (Ctrl+K)"
          >
            <Search className="w-4 h-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Connection Indicator Component
// =============================================================================

interface ConnectionIndicatorProps {
  connectionInfo?: {
    url: string;
    name?: string;
  } | null;
  onDisconnect: () => void;
}

function ConnectionIndicator({ connectionInfo, onDisconnect }: ConnectionIndicatorProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isConnected = !!connectionInfo;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={cn(
          'flex items-center gap-2 px-2.5 py-1.5 rounded-lg',
          'text-sm transition-all duration-150',
          isConnected
            ? 'bg-success-muted text-success hover:bg-success/20'
            : 'bg-error-muted text-error hover:bg-error/20',
        )}
        title={isConnected ? `Connected to ${connectionInfo.name || connectionInfo.url}` : 'Not connected'}
      >
        {isConnected ? (
          <Wifi className="w-4 h-4" />
        ) : (
          <WifiOff className="w-4 h-4" />
        )}
        <span className="hidden lg:inline max-w-[120px] truncate">
          {isConnected ? (connectionInfo.name || 'Connected') : 'Disconnected'}
        </span>
      </button>

      <AnimatePresence>
        {showMenu && isConnected && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full mt-2 w-64',
              'bg-bg-surface border border-border rounded-lg',
              'shadow-floating py-2 px-3',
            )}
          >
            <div className="mb-2">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Connected Node</p>
              <p className="text-sm font-medium text-text-primary truncate">
                {connectionInfo.name || 'Remote Node'}
              </p>
              <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                {connectionInfo.url}
              </p>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onDisconnect();
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md',
                  'text-sm text-error hover:bg-error-muted',
                  'transition-all duration-150',
                )}
              >
                <Unplug className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Main TopNavBar Component
// =============================================================================

export function TopNavBar({ connectionInfo }: TopNavBarProps) {
  const { searchOpen, searchQuery, toggleSearch, setSearchQuery } = useAppStore();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleDisconnect = useCallback(() => {
    if (confirm('Disconnect from this node? You will need to reconnect to manage it.')) {
      setNodeConnection(null);
      window.location.reload();
    }
  }, []);

  return (
    <header
      ref={navRef}
      className={cn(
        'h-14 bg-bg-surface border-b border-border',
        'flex items-center justify-between px-4',
        'shrink-0 sticky top-0 z-40',
      )}
    >
      {/* Left: Logo + Navigation */}
      <div className="flex items-center gap-5">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-floating">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-text-primary tracking-tight text-base leading-tight">
              Quantix
            </span>
            <span className="text-[9px] text-text-muted uppercase tracking-widest">
              Host Manager
            </span>
          </div>
        </Link>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Navigation Items */}
        <nav className="flex items-center gap-0.5">
          {navigation.map((item) => (
            <NavItemComponent
              key={item.id}
              item={item}
              openDropdown={openDropdown}
              setOpenDropdown={setOpenDropdown}
            />
          ))}
        </nav>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <SearchBar
          isOpen={searchOpen}
          onToggle={toggleSearch}
          query={searchQuery}
          onQueryChange={setSearchQuery}
        />

        {/* Connection Indicator */}
        <ConnectionIndicator
          connectionInfo={connectionInfo}
          onDisconnect={handleDisconnect}
        />

        {/* Theme Toggle */}
        <ThemeToggle />
      </div>
    </header>
  );
}

export default TopNavBar;
