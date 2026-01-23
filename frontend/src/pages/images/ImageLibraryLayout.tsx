import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Cloud, Download, Upload, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UploadProgressToast } from '@/components/storage';
import { useUploadStore } from '@/lib/upload-store';

const tabs = [
  { id: 'all', label: 'All Images', icon: Cloud, path: '/storage/images' },
  { id: 'downloads', label: 'Downloads', icon: Download, path: '/storage/images/downloads' },
  { id: 'uploads', label: 'Uploads', icon: Upload, path: '/storage/images/uploads' },
  { id: 'config', label: 'Configurations', icon: Settings, path: '/storage/images/config' },
];

export function ImageLibraryLayout() {
  const location = useLocation();
  const { uploads, removeUpload } = useUploadStore();

  // Determine active tab based on pathname
  const getActiveTab = () => {
    if (location.pathname === '/storage/images') return 'all';
    if (location.pathname.includes('/downloads')) return 'downloads';
    if (location.pathname.includes('/uploads')) return 'uploads';
    if (location.pathname.includes('/config')) return 'config';
    return 'all';
  };

  const activeTab = getActiveTab();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Image Library</h1>
        <p className="text-text-muted mt-1">
          Manage cloud images, ISO files, and OVA templates for VM provisioning
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-bg-surface border border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <NavLink
              key={tab.id}
              to={tab.path}
              end={tab.id === 'all'}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              <Icon className={cn('w-4 h-4', isActive && 'text-accent')} />
              {tab.label}
            </NavLink>
          );
        })}
      </div>

      {/* Nested Route Content */}
      <Outlet />

      {/* Upload Progress Toast */}
      <UploadProgressToast uploads={uploads} onDismiss={removeUpload} />
    </div>
  );
}
