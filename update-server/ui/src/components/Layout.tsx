import { Link, Outlet, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  Upload, 
  Settings, 
  Server,
  RefreshCw,
  Disc
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  { path: '/releases', label: 'Releases', icon: <Package size={20} /> },
  { path: '/isos', label: 'Agent ISOs', icon: <Disc size={20} /> },
  { path: '/publish', label: 'Publish', icon: <Upload size={20} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
];

function Layout() {
  const location = useLocation();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health');
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div className="min-h-screen bg-qx-base flex">
      {/* Sidebar */}
      <aside className="w-64 bg-qx-surface border-r border-qx-hover flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-qx-hover">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-qx-accent rounded-lg flex items-center justify-center">
              <Server size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-qx-text">Quantix</h1>
              <p className="text-xs text-qx-muted">Update Server</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg transition-all
                      ${isActive 
                        ? 'bg-qx-accent text-white' 
                        : 'text-qx-muted hover:bg-qx-hover hover:text-qx-text'
                      }
                    `}
                  >
                    {item.icon}
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Status */}
        <div className="p-4 border-t border-qx-hover">
          <div className="flex items-center gap-2 text-sm">
            {healthLoading ? (
              <RefreshCw size={14} className="animate-spin text-qx-muted" />
            ) : health ? (
              <div className="w-2 h-2 bg-green-500 rounded-full" />
            ) : (
              <div className="w-2 h-2 bg-red-500 rounded-full" />
            )}
            <span className="text-qx-muted">
              {healthLoading ? 'Checking...' : health ? 'Server Online' : 'Server Offline'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default Layout;
