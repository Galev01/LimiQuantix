import { useState, useRef, useEffect, useCallback } from 'react';
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
  ChevronDown,
  MonitorCog,
  Boxes,
  FolderTree,
  Layers,
  Plus,
  Activity,
  Bell,
  Zap,
  Cloud,
  Scale,
  KeyRound,
  Radio,
  ShieldCheck,
  ScrollText,
  Search,
  User,
  Download,
  Upload,
  FileJson,
  ChevronRight,
  X,
} from 'lucide-react';
import QuantixLogo from '@/assets/Logo.png';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app-store';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

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
  divider?: boolean;
}

// =============================================================================
// Navigation Structure
// =============================================================================

const navigation: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: FolderTree,
    children: [
      {
        id: 'vms-group',
        label: 'Virtual Machines',
        icon: MonitorCog,
        children: [
          { id: 'vm-list', label: 'VM List', icon: MonitorCog, href: '/vms' },
          { id: 'vm-folders', label: 'Folder View', icon: FolderTree, href: '/vms/folders' },
          { id: 'vm-clusters', label: 'Cluster View', icon: Boxes, href: '/vms/clusters' },
        ],
      },
      { id: 'hosts', label: 'Hosts', icon: Server, href: '/hosts' },
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
      {
        id: 'images-group',
        label: 'Image Library',
        icon: Cloud,
        children: [
          { id: 'images', label: 'All Images', icon: Cloud, href: '/storage/images' },
          { id: 'downloads', label: 'Downloads', icon: Download, href: '/storage/images/downloads' },
          { id: 'uploads', label: 'Uploads', icon: Upload, href: '/storage/images/uploads' },
          { id: 'configs', label: 'Configurations', icon: FileJson, href: '/storage/images/config' },
        ],
      },
    ],
  },
  {
    id: 'networking',
    label: 'Networking',
    icon: Network,
    children: [
      {
        id: 'vnet-group',
        label: 'Virtual Networking',
        icon: Network,
        children: [
          { id: 'networks', label: 'Virtual Networks', icon: Network, href: '/networks' },
          { id: 'distributed-switch', label: 'qdvSwitch', icon: Layers, href: '/networks/distributed-switch' },
          { id: 'load-balancers', label: 'Load Balancers', icon: Scale, href: '/networks/load-balancers' },
          { id: 'vpn', label: 'VPN Services', icon: KeyRound, href: '/networks/vpn' },
          { id: 'bgp', label: 'BGP Speakers', icon: Radio, href: '/networks/bgp' },
          { id: 'security', label: 'Security Groups', icon: Shield, href: '/security' },
        ],
      },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Activity,
    children: [
      { id: 'monitoring', label: 'Monitoring', icon: Activity, href: '/monitoring' },
      { id: 'alerts', label: 'Alerts', icon: Bell, href: '/alerts' },
      { id: 'drs', label: 'DRS Recommendations', icon: Zap, href: '/drs' },
      { id: 'logs', label: 'System Logs', icon: ScrollText, href: '/logs' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  { id: 'admin', label: 'Admin Panel', icon: ShieldCheck, href: '/admin' },
];

// =============================================================================
// Dropdown Menu Component
// =============================================================================

interface DropdownMenuProps {
  items: NavItem[];
  isOpen: boolean;
  onClose: () => void;
  level?: number;
  parentRef?: React.RefObject<HTMLElement | null>;
}

function DropdownMenu({ items, isOpen, onClose, level = 0, parentRef }: DropdownMenuProps) {
  const [expandedSubmenu, setExpandedSubmenu] = useState<string | null>(null);
  const location = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate position based on parent
  const getPosition = useCallback(() => {
    if (level === 0) {
      return { top: '100%', left: 0 };
    }
    return { top: 0, left: '100%' };
  }, [level]);

  const handleItemClick = (item: NavItem) => {
    if (item.children) {
      setExpandedSubmenu(expandedSubmenu === item.id ? null : item.id);
    } else {
      onClose();
    }
  };

  const isActive = (item: NavItem): boolean => {
    if (item.href) {
      return location.pathname === item.href || 
        (item.href !== '/' && location.pathname.startsWith(item.href.split('?')[0]));
    }
    return item.children?.some(isActive) || false;
  };

  const position = getPosition();

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: level === 0 ? -8 : 0, x: level > 0 ? -8 : 0 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          exit={{ opacity: 0, y: level === 0 ? -8 : 0, x: level > 0 ? -8 : 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={cn(
            'absolute z-50 min-w-[220px]',
            'bg-bg-surface border border-border rounded-lg',
            'shadow-floating py-1.5',
            'backdrop-blur-sm',
          )}
          style={{
            top: position.top,
            left: position.left,
            marginTop: level === 0 ? '4px' : 0,
            marginLeft: level > 0 ? '4px' : 0,
          }}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            const hasChildren = item.children && item.children.length > 0;
            const active = isActive(item);
            const isSubmenuOpen = expandedSubmenu === item.id;

            return (
              <div key={item.id} className="relative">
                {item.divider && index > 0 && (
                  <div className="my-1.5 mx-2 border-t border-border" />
                )}
                
                {item.href && !hasChildren ? (
                  <Link
                    to={item.href}
                    onClick={() => onClose()}
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
                ) : (
                  <div className="relative">
                    <button
                      onClick={() => handleItemClick(item)}
                      onMouseEnter={() => hasChildren && setExpandedSubmenu(item.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 mx-1.5 rounded-md',
                        'text-sm transition-all duration-150',
                        active
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                      )}
                      style={{ width: 'calc(100% - 12px)' }}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {hasChildren && (
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                    
                    {hasChildren && (
                      <DropdownMenu
                        items={item.children!}
                        isOpen={isSubmenuOpen}
                        onClose={onClose}
                        level={level + 1}
                      />
                    )}
                  </div>
                )}
              </div>
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
    : item.children?.some((child) => {
        if (child.href) {
          return location.pathname === child.href || location.pathname.startsWith(child.href.split('?')[0]);
        }
        return child.children?.some((subChild) => 
          subChild.href && (location.pathname === subChild.href || location.pathname.startsWith(subChild.href.split('?')[0]))
        );
      });

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
          parentRef={itemRef}
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
            animate={{ width: 280, opacity: 1 }}
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
              placeholder="Search VMs, hosts..."
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
            title="Search (⌘K)"
          >
            <Search className="w-4 h-4" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Profile Menu Component
// =============================================================================

function ProfileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 p-1.5 rounded-lg',
          'hover:bg-bg-hover',
          'transition-all duration-150',
        )}
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center">
          <User className="w-4 h-4 text-white" />
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full mt-2 w-48',
              'bg-bg-surface border border-border rounded-lg',
              'shadow-floating py-1.5',
            )}
          >
            <div className="px-3 py-2 border-b border-border mb-1">
              <p className="text-sm font-medium text-text-primary">Admin User</p>
              <p className="text-xs text-text-muted">admin@quantix.local</p>
            </div>
            <Link
              to="/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Link>
            <button
              onClick={() => setIsOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error-muted"
            >
              <X className="w-4 h-4" />
              Sign Out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================
// Main TopNavBar Component
// =============================================================================

export function TopNavBar() {
  const { openVmWizard, searchOpen, searchQuery, toggleSearch, setSearchQuery } = useAppStore();
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
      <div className="flex items-center gap-6">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <img 
            src={QuantixLogo} 
            alt="Quantix" 
            className="w-10 h-10 object-contain"
          />
          <div className="flex flex-col">
            <span className="font-bold text-text-primary tracking-tight text-base leading-tight">
              Quantix
            </span>
            <span className="text-[9px] text-text-muted uppercase tracking-widest">
              vDC
            </span>
          </div>
        </Link>

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Navigation Items */}
        <nav className="flex items-center gap-1">
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

        {/* Create VM Button */}
        <button
          onClick={openVmWizard}
          className={cn(
            'flex items-center gap-2 px-3.5 py-1.5 rounded-lg',
            'bg-accent hover:bg-accent-hover',
            'text-white text-sm font-medium',
            'shadow-floating hover:shadow-elevated',
            'transition-all duration-150',
          )}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New VM</span>
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <button
          className={cn(
            'relative p-2 rounded-lg',
            'text-text-muted hover:text-text-primary',
            'hover:bg-bg-hover',
            'transition-all duration-150',
          )}
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error rounded-full" />
        </button>

        {/* Profile */}
        <ProfileMenu />
      </div>
    </header>
  );
}

export default TopNavBar;
