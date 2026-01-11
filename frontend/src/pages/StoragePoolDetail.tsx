import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Database,
  HardDrive,
  Server,
  Folder,
  File,
  FileImage,
  FileVideo,
  FileArchive,
  ChevronRight,
  RefreshCw,
  MoreHorizontal,
  Trash2,
  Settings,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  Plus,
  Upload,
  Download,
  Copy,
  FolderOpen,
  Server as ServerIcon,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  useStoragePool,
  usePoolFiles,
  useAssignPoolToNode,
  useUnassignPoolFromNode,
  useReconnectStoragePool,
  useDeleteStoragePool,
  type StoragePoolUI,
  type PoolFileEntry,
} from '@/hooks/useStorage';
import { useNodes } from '@/hooks/useNodes';
import { toast } from 'sonner';

// File type icons mapping
const fileTypeIcons: Record<string, typeof File> = {
  directory: FolderOpen,
  qcow2: FileImage,
  vmdk: FileImage,
  iso: FileArchive,
  img: FileImage,
  vhd: FileImage,
  raw: FileImage,
  ova: FileArchive,
  ovf: File,
};

const statusConfig = {
  PENDING: { label: 'Pending', variant: 'default' as const, icon: Loader2, color: 'text-text-secondary' },
  READY: { label: 'Ready', variant: 'success' as const, icon: CheckCircle, color: 'text-success' },
  DEGRADED: { label: 'Degraded', variant: 'warning' as const, icon: AlertTriangle, color: 'text-warning' },
  ERROR: { label: 'Error', variant: 'error' as const, icon: XCircle, color: 'text-error' },
  DELETING: { label: 'Deleting', variant: 'default' as const, icon: Loader2, color: 'text-text-secondary' },
};

const typeConfig = {
  CEPH_RBD: { label: 'Ceph RBD', icon: Database },
  NFS: { label: 'NFS', icon: Server },
  ISCSI: { label: 'iSCSI', icon: HardDrive },
  LOCAL_DIR: { label: 'Local', icon: Folder },
  LOCAL_LVM: { label: 'LVM', icon: HardDrive },
};

export function StoragePoolDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [currentPath, setCurrentPath] = useState('');
  const [activeTab, setActiveTab] = useState<'files' | 'nodes' | 'settings'>('files');

  // Fetch data
  const { data: pool, isLoading: poolLoading, refetch: refetchPool } = useStoragePool(id || '');
  const { data: files = [], isLoading: filesLoading, refetch: refetchFiles } = usePoolFiles(id || '', currentPath);
  const { data: nodesData } = useNodes();
  const allNodes = nodesData?.nodes ?? [];

  // Mutations
  const assignToNode = useAssignPoolToNode();
  const unassignFromNode = useUnassignPoolFromNode();
  const reconnectPool = useReconnectStoragePool();
  const deletePool = useDeleteStoragePool();

  if (!id) {
    return <div className="p-6 text-text-secondary">Pool ID not provided</div>;
  }

  if (poolLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-secondary mb-4">Storage pool not found</p>
        <Button onClick={() => navigate('/storage/pools')}>Back to Pools</Button>
      </div>
    );
  }

  const status = statusConfig[pool.status.phase];
  const TypeIcon = typeConfig[pool.type]?.icon || Database;
  const StatusIcon = status.icon;
  const usagePercent = pool.capacity.totalBytes > 0 
    ? Math.round((pool.capacity.usedBytes / pool.capacity.totalBytes) * 100) 
    : 0;

  // Build breadcrumb path
  const pathParts = currentPath.split('/').filter(Boolean);

  const handleNavigateToFolder = (path: string) => {
    setCurrentPath(path);
  };

  const handleNavigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const handleAssignNode = async (nodeId: string) => {
    try {
      await assignToNode.mutateAsync({ poolId: id, nodeId });
      refetchPool();
    } catch (err) {
      toast.error(`Failed to assign node: ${(err as Error).message}`);
    }
  };

  const handleUnassignNode = async (nodeId: string) => {
    try {
      await unassignFromNode.mutateAsync({ poolId: id, nodeId });
      refetchPool();
    } catch (err) {
      toast.error(`Failed to unassign node: ${(err as Error).message}`);
    }
  };

  const handleReconnect = async () => {
    toast.loading(`Reconnecting pool "${pool.name}"...`, { id: `reconnect-${id}` });
    try {
      await reconnectPool.mutateAsync(id);
      toast.dismiss(`reconnect-${id}`);
      refetchPool();
    } catch (err) {
      toast.dismiss(`reconnect-${id}`);
      toast.error(`Failed to reconnect: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete pool "${pool.name}"?`)) return;
    
    try {
      await deletePool.mutateAsync(id);
      toast.success(`Pool "${pool.name}" deleted`);
      navigate('/storage/pools');
    } catch (err) {
      toast.error(`Failed to delete pool: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/storage/pools')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-3 rounded-xl",
              pool.status.phase === 'READY' ? "bg-success/10" : "bg-bg-surface"
            )}>
              <TypeIcon className={cn("w-6 h-6", status.color)} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-text-primary">{pool.name}</h1>
              <p className="text-sm text-text-secondary flex items-center gap-2">
                <span>{typeConfig[pool.type]?.label}</span>
                <span>•</span>
                <Badge variant={status.variant}>
                  <StatusIcon className={cn("w-3 h-3 mr-1", status.icon === Loader2 && "animate-spin")} />
                  {status.label}
                </Badge>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { refetchPool(); refetchFiles(); }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          {(pool.status.phase === 'ERROR' || pool.status.phase === 'PENDING') && (
            <Button variant="secondary" size="sm" onClick={handleReconnect}>
              Reconnect
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Error message */}
      {pool.status.errorMessage && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/30">
          <div className="flex items-start gap-2">
            <XCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-error">Error</p>
              <p className="text-sm text-error/80 mt-0.5">{pool.status.errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-text-secondary uppercase tracking-wider">Total Capacity</p>
          <p className="text-2xl font-semibold text-text-primary mt-1">
            {formatBytes(pool.capacity.totalBytes)}
          </p>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-text-secondary uppercase tracking-wider">Used</p>
          <p className="text-2xl font-semibold text-text-primary mt-1">
            {formatBytes(pool.capacity.usedBytes)}
            <span className="text-sm text-text-secondary ml-2">({usagePercent}%)</span>
          </p>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-text-secondary uppercase tracking-wider">Available</p>
          <p className="text-2xl font-semibold text-success mt-1">
            {formatBytes(pool.capacity.availableBytes)}
          </p>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <p className="text-xs text-text-secondary uppercase tracking-wider">Volumes</p>
          <p className="text-2xl font-semibold text-text-primary mt-1">
            {pool.status.volumeCount}
          </p>
        </div>
      </div>

      {/* Usage bar */}
      <div className="bg-bg-surface rounded-xl p-4 border border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-text-secondary">Storage Usage</span>
          <span className="text-sm font-medium text-text-primary">{usagePercent}%</span>
        </div>
        <div className="h-2 bg-bg-base rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-500",
              usagePercent > 90 ? "bg-error" : usagePercent > 75 ? "bg-warning" : "bg-accent"
            )}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-bg-surface rounded-lg p-1 w-fit border border-border">
        {(['files', 'nodes', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize",
              activeTab === tab
                ? "bg-bg-elevated text-text-primary shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'files' && (
          <motion.div
            key="files"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-bg-surface rounded-xl border border-border overflow-hidden"
          >
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 p-4 border-b border-border bg-bg-base/50">
              <button
                onClick={() => setCurrentPath('')}
                className="text-sm text-accent hover:underline"
              >
                Root
              </button>
              {pathParts.map((part, index) => (
                <div key={index} className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                  <button
                    onClick={() => handleNavigateToFolder(pathParts.slice(0, index + 1).join('/'))}
                    className="text-sm text-accent hover:underline"
                  >
                    {part}
                  </button>
                </div>
              ))}
              
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => refetchFiles()}>
                  <RefreshCw className={cn("w-4 h-4", filesLoading && "animate-spin")} />
                </Button>
              </div>
            </div>

            {/* File List */}
            <div className="divide-y divide-border">
              {currentPath && (
                <button
                  onClick={handleNavigateUp}
                  className="w-full flex items-center gap-3 p-3 hover:bg-bg-hover transition-colors"
                >
                  <Folder className="w-5 h-5 text-text-muted" />
                  <span className="text-sm text-text-secondary">..</span>
                </button>
              )}

              {filesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
                </div>
              ) : files.length === 0 ? (
                <div className="text-center py-12">
                  <Folder className="w-12 h-12 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary">This folder is empty</p>
                </div>
              ) : (
                files.map((file) => {
                  const FileIcon = fileTypeIcons[file.isDirectory ? 'directory' : file.fileType] || File;
                  return (
                    <button
                      key={file.path}
                      onClick={() => file.isDirectory && handleNavigateToFolder(file.path)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 transition-colors text-left",
                        file.isDirectory 
                          ? "hover:bg-bg-hover cursor-pointer" 
                          : "cursor-default"
                      )}
                    >
                      <FileIcon className={cn(
                        "w-5 h-5 shrink-0",
                        file.isDirectory ? "text-accent" : "text-text-muted"
                      )} />
                      <span className="text-sm text-text-primary flex-1 truncate">
                        {file.name}
                      </span>
                      {!file.isDirectory && (
                        <span className="text-xs text-text-muted">
                          {formatBytes(file.sizeBytes)}
                        </span>
                      )}
                      <span className="text-xs text-text-muted">
                        {file.modifiedAt}
                      </span>
                      {file.isDirectory && (
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'nodes' && (
          <motion.div
            key="nodes"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-text-primary">Assigned Nodes</h3>
              <p className="text-sm text-text-secondary">
                {pool.assignedNodeIds.length} of {allNodes.length} nodes assigned
              </p>
            </div>

            <div className="bg-bg-surface rounded-xl border border-border divide-y divide-border">
              {allNodes.length === 0 ? (
                <div className="text-center py-12">
                  <ServerIcon className="w-12 h-12 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary">No nodes available</p>
                </div>
              ) : (
                allNodes.map((node) => {
                  const isAssigned = pool.assignedNodeIds.includes(node.id);
                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-lg",
                          isAssigned ? "bg-success/10" : "bg-bg-base"
                        )}>
                          <ServerIcon className={cn(
                            "w-5 h-5",
                            isAssigned ? "text-success" : "text-text-muted"
                          )} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {node.hostname}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {node.managementIp}
                          </p>
                        </div>
                      </div>

                      <Button
                        variant={isAssigned ? "destructive" : "secondary"}
                        size="sm"
                        onClick={() => isAssigned 
                          ? handleUnassignNode(node.id) 
                          : handleAssignNode(node.id)
                        }
                        disabled={assignToNode.isPending || unassignFromNode.isPending}
                      >
                        {isAssigned ? 'Unassign' : 'Assign'}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>

            <p className="text-xs text-text-muted">
              VMs can only be created on nodes that have access to the storage pool they will use.
            </p>
          </motion.div>
        )}

        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-bg-surface rounded-xl border border-border p-6 space-y-6"
          >
            <h3 className="text-lg font-medium text-text-primary">Pool Settings</h3>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-1">
                  Pool ID
                </label>
                <p className="text-sm font-mono text-text-primary bg-bg-base px-3 py-2 rounded-lg">
                  {pool.id}
                </p>
              </div>
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-1">
                  Project ID
                </label>
                <p className="text-sm text-text-primary bg-bg-base px-3 py-2 rounded-lg">
                  {pool.projectId}
                </p>
              </div>
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-1">
                  Type
                </label>
                <p className="text-sm text-text-primary bg-bg-base px-3 py-2 rounded-lg flex items-center gap-2">
                  <TypeIcon className="w-4 h-4" />
                  {typeConfig[pool.type]?.label}
                </p>
              </div>
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-1">
                  Created
                </label>
                <p className="text-sm text-text-primary bg-bg-base px-3 py-2 rounded-lg">
                  {pool.createdAt.toLocaleDateString()} {pool.createdAt.toLocaleTimeString()}
                </p>
              </div>
            </div>

            {pool.description && (
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-1">
                  Description
                </label>
                <p className="text-sm text-text-primary bg-bg-base px-3 py-2 rounded-lg">
                  {pool.description}
                </p>
              </div>
            )}

            {Object.keys(pool.labels).length > 0 && (
              <div>
                <label className="block text-xs text-text-secondary uppercase tracking-wider mb-2">
                  Labels
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(pool.labels).map(([key, value]) => (
                    <Badge key={key} variant="default">
                      {key}: {value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StoragePoolDetail;
