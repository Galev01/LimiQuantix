import { useQuery } from '@tanstack/react-query';
import { 
  Package, 
  Server, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  GitBranch,
  RefreshCw
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Release {
  version: string;
  channel: string;
  release_date: string;
  components: number;
}

interface ChannelInfo {
  name: string;
  description: string;
}

function Dashboard() {
  const { data: channels } = useQuery<ChannelInfo[]>({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await fetch('/api/v1/channels');
      if (!res.ok) throw new Error('Failed to fetch channels');
      return res.json();
    },
  });

  const { data: quantixOsReleases, isLoading: osLoading } = useQuery<Release[]>({
    queryKey: ['releases', 'quantix-os'],
    queryFn: async () => {
      const res = await fetch('/api/v1/quantix-os/releases');
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to fetch releases');
      }
      return res.json();
    },
  });

  const { data: quantixVdcReleases, isLoading: vdcLoading } = useQuery<Release[]>({
    queryKey: ['releases', 'quantix-vdc'],
    queryFn: async () => {
      const res = await fetch('/api/v1/quantix-vdc/releases');
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to fetch releases');
      }
      return res.json();
    },
  });

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health');
      if (!res.ok) throw new Error('Health check failed');
      return res.json();
    },
  });

  const isLoading = osLoading || vdcLoading;
  const totalReleases = (quantixOsReleases?.length || 0) + (quantixVdcReleases?.length || 0);
  const latestOsRelease = quantixOsReleases?.[0];
  const latestVdcRelease = quantixVdcReleases?.[0];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-qx-text">Dashboard</h1>
        <p className="text-qx-muted mt-1">Quantix Update Server Overview</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={<Server className="text-qx-accent" />}
          label="Server Status"
          value={health ? 'Online' : 'Offline'}
          status={health ? 'success' : 'error'}
        />
        <StatCard
          icon={<Package className="text-purple-400" />}
          label="Total Releases"
          value={isLoading ? '...' : String(totalReleases)}
        />
        <StatCard
          icon={<GitBranch className="text-green-400" />}
          label="Channels"
          value={String(channels?.length || 3)}
        />
        <StatCard
          icon={<Clock className="text-yellow-400" />}
          label="Last Update"
          value={latestOsRelease?.release_date 
            ? formatDistanceToNow(new Date(latestOsRelease.release_date), { addSuffix: true })
            : 'Never'
          }
        />
      </div>

      {/* Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProductCard
          name="Quantix-OS"
          description="Hypervisor operating system updates"
          releases={quantixOsReleases || []}
          loading={osLoading}
          latestVersion={latestOsRelease?.version}
        />
        <ProductCard
          name="Quantix-vDC"
          description="Control plane and dashboard updates"
          releases={quantixVdcReleases || []}
          loading={vdcLoading}
          latestVersion={latestVdcRelease?.version}
        />
      </div>

      {/* Channels */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-qx-text mb-4">Release Channels</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(channels || [
            { name: 'dev', description: 'Development builds for testing' },
            { name: 'beta', description: 'Pre-release builds for early adopters' },
            { name: 'stable', description: 'Production-ready releases' },
          ]).map((channel) => (
            <div
              key={channel.name}
              className="bg-qx-surface border border-qx-hover rounded-lg p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`
                  w-3 h-3 rounded-full
                  ${channel.name === 'stable' ? 'bg-green-500' : 
                    channel.name === 'beta' ? 'bg-yellow-500' : 'bg-blue-500'}
                `} />
                <span className="font-semibold text-qx-text capitalize">{channel.name}</span>
              </div>
              <p className="text-sm text-qx-muted">{channel.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  status?: 'success' | 'error' | 'warning';
}

function StatCard({ icon, label, value, status }: StatCardProps) {
  return (
    <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-qx-elevated rounded-lg flex items-center justify-center">
          {icon}
        </div>
        {status && (
          status === 'success' ? (
            <CheckCircle2 className="text-green-500" size={20} />
          ) : status === 'error' ? (
            <AlertCircle className="text-red-500" size={20} />
          ) : null
        )}
      </div>
      <p className="text-qx-muted text-sm">{label}</p>
      <p className="text-2xl font-bold text-qx-text mt-1">{value}</p>
    </div>
  );
}

interface ProductCardProps {
  name: string;
  description: string;
  releases: Release[];
  loading: boolean;
  latestVersion?: string;
}

function ProductCard({ name, description, releases, loading, latestVersion }: ProductCardProps) {
  return (
    <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-qx-text">{name}</h3>
          <p className="text-sm text-qx-muted">{description}</p>
        </div>
        {latestVersion && (
          <span className="px-3 py-1 bg-qx-accent/20 text-qx-accent rounded-full text-sm font-medium">
            v{latestVersion}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="animate-spin text-qx-muted" />
        </div>
      ) : releases.length === 0 ? (
        <div className="text-center py-8 text-qx-muted">
          No releases yet
        </div>
      ) : (
        <div className="space-y-2">
          {releases.slice(0, 5).map((release) => (
            <div
              key={`${release.version}-${release.channel}`}
              className="flex items-center justify-between py-2 border-b border-qx-hover last:border-0"
            >
              <div className="flex items-center gap-3">
                <Package size={16} className="text-qx-muted" />
                <span className="text-qx-text font-medium">v{release.version}</span>
                <span className={`
                  px-2 py-0.5 rounded text-xs
                  ${release.channel === 'stable' ? 'bg-green-500/20 text-green-400' :
                    release.channel === 'beta' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-500/20 text-blue-400'}
                `}>
                  {release.channel}
                </span>
              </div>
              <span className="text-xs text-qx-muted">
                {formatDistanceToNow(new Date(release.release_date), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
