import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Package, 
  Download, 
  Trash2, 
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FileJson,
  HardDrive,
  Clock
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';

interface Component {
  name: string;
  version: string;
  artifact: string;
  sha256: string;
  size_bytes: number;
  install_path: string;
}

interface Manifest {
  product: string;
  version: string;
  channel: string;
  release_date: string;
  update_type: string;
  components: Component[];
  release_notes?: string;
}

interface Release {
  version: string;
  channel: string;
  release_date: string;
  manifest?: Manifest;
}

function Releases() {
  const [selectedProduct, setSelectedProduct] = useState<'quantix-os' | 'quantix-vdc'>('quantix-os');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data: releases, isLoading, refetch } = useQuery<Release[]>({
    queryKey: ['releases', selectedProduct],
    queryFn: async () => {
      const res = await fetch(`/api/v1/${selectedProduct}/releases`);
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to fetch releases');
      }
      return res.json();
    },
  });

  const fetchManifest = async (version: string, channel: string): Promise<Manifest> => {
    const res = await fetch(`/api/v1/${selectedProduct}/releases/${version}/manifest?channel=${channel}`);
    if (!res.ok) throw new Error('Failed to fetch manifest');
    return res.json();
  };

  const deleteRelease = useMutation({
    mutationFn: async ({ version, channel }: { version: string; channel: string }) => {
      const token = localStorage.getItem('publish_token') || 'dev-token';
      const res = await fetch(`/api/v1/${selectedProduct}/releases/${version}?channel=${channel}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to delete release');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['releases', selectedProduct] });
      toast.success('Release deleted successfully');
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const filteredReleases = releases?.filter(
    (r) => selectedChannel === 'all' || r.channel === selectedChannel
  );

  const toggleExpand = async (version: string, channel: string) => {
    const key = `${version}-${channel}`;
    if (expandedVersion === key) {
      setExpandedVersion(null);
    } else {
      setExpandedVersion(key);
      // Fetch manifest if not already loaded
      const release = releases?.find(r => r.version === version && r.channel === channel);
      if (release && !release.manifest) {
        try {
          const manifest = await fetchManifest(version, channel);
          queryClient.setQueryData(['releases', selectedProduct], (old: Release[] | undefined) =>
            old?.map(r => 
              r.version === version && r.channel === channel 
                ? { ...r, manifest } 
                : r
            )
          );
        } catch (error) {
          console.error('Failed to fetch manifest:', error);
        }
      }
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-qx-text">Releases</h1>
          <p className="text-qx-muted mt-1">Manage published updates</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-qx-surface border border-qx-hover rounded-lg hover:bg-qx-hover transition-colors"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        {/* Product selector */}
        <div className="flex bg-qx-surface border border-qx-hover rounded-lg overflow-hidden">
          <button
            onClick={() => setSelectedProduct('quantix-os')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              selectedProduct === 'quantix-os'
                ? 'bg-qx-accent text-white'
                : 'text-qx-muted hover:text-qx-text'
            }`}
          >
            Quantix-OS
          </button>
          <button
            onClick={() => setSelectedProduct('quantix-vdc')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              selectedProduct === 'quantix-vdc'
                ? 'bg-qx-accent text-white'
                : 'text-qx-muted hover:text-qx-text'
            }`}
          >
            Quantix-vDC
          </button>
        </div>

        {/* Channel filter */}
        <select
          value={selectedChannel}
          onChange={(e) => setSelectedChannel(e.target.value)}
          className="px-4 py-2 bg-qx-surface border border-qx-hover rounded-lg text-qx-text focus:outline-none focus:ring-2 focus:ring-qx-accent"
        >
          <option value="all">All Channels</option>
          <option value="dev">Dev</option>
          <option value="beta">Beta</option>
          <option value="stable">Stable</option>
        </select>
      </div>

      {/* Releases List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="animate-spin text-qx-muted" size={32} />
        </div>
      ) : filteredReleases?.length === 0 ? (
        <div className="text-center py-16">
          <Package size={48} className="mx-auto text-qx-muted mb-4" />
          <p className="text-qx-muted">No releases found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredReleases?.map((release) => {
            const key = `${release.version}-${release.channel}`;
            const isExpanded = expandedVersion === key;

            return (
              <div
                key={key}
                className="bg-qx-surface border border-qx-hover rounded-xl overflow-hidden"
              >
                {/* Release Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-qx-elevated transition-colors"
                  onClick={() => toggleExpand(release.version, release.channel)}
                >
                  <div className="flex items-center gap-4">
                    <Package size={24} className="text-qx-accent" />
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-qx-text">
                          v{release.version}
                        </span>
                        <span className={`
                          px-2 py-0.5 rounded text-xs font-medium
                          ${release.channel === 'stable' ? 'bg-green-500/20 text-green-400' :
                            release.channel === 'beta' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'}
                        `}>
                          {release.channel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-qx-muted mt-1">
                        <Clock size={14} />
                        {formatDistanceToNow(new Date(release.release_date), { addSuffix: true })}
                        <span className="text-qx-hover">|</span>
                        {format(new Date(release.release_date), 'PPpp')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Download manifest
                        window.open(
                          `/api/v1/${selectedProduct}/releases/${release.version}/manifest?channel=${release.channel}`,
                          '_blank'
                        );
                      }}
                      className="p-2 hover:bg-qx-hover rounded-lg transition-colors"
                      title="Download Manifest"
                    >
                      <FileJson size={18} className="text-qx-muted" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete v${release.version} (${release.channel})?`)) {
                          deleteRelease.mutate({ version: release.version, channel: release.channel });
                        }
                      }}
                      className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Delete Release"
                    >
                      <Trash2 size={18} className="text-red-400" />
                    </button>
                    {isExpanded ? (
                      <ChevronUp size={20} className="text-qx-muted" />
                    ) : (
                      <ChevronDown size={20} className="text-qx-muted" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && release.manifest && (
                  <div className="border-t border-qx-hover p-4 bg-qx-base">
                    {/* Release Notes */}
                    {release.manifest.release_notes && (
                      <div className="mb-4 p-3 bg-qx-surface rounded-lg">
                        <p className="text-sm text-qx-muted mb-1">Release Notes:</p>
                        <p className="text-qx-text whitespace-pre-wrap">
                          {release.manifest.release_notes}
                        </p>
                      </div>
                    )}

                    {/* Components */}
                    <p className="text-sm text-qx-muted mb-2">Components:</p>
                    <div className="space-y-2">
                      {release.manifest.components.map((component) => (
                        <div
                          key={component.name}
                          className="flex items-center justify-between p-3 bg-qx-surface rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <HardDrive size={18} className="text-qx-muted" />
                            <div>
                              <span className="font-medium text-qx-text">{component.name}</span>
                              <p className="text-xs text-qx-muted">
                                {component.install_path}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-qx-muted">
                              {formatBytes(component.size_bytes)}
                            </span>
                            <button
                              onClick={() => window.open(
                                `/api/v1/${selectedProduct}/releases/${release.version}/${component.artifact}?channel=${release.channel}`,
                                '_blank'
                              )}
                              className="flex items-center gap-1 px-3 py-1 bg-qx-accent/20 text-qx-accent rounded-lg hover:bg-qx-accent/30 transition-colors"
                            >
                              <Download size={14} />
                              Download
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Releases;
