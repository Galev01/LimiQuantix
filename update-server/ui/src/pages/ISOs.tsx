import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Disc, 
  Download, 
  Trash2, 
  RefreshCw,
  Upload,
  Clock,
  HardDrive,
  Copy,
  Check,
  ExternalLink
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { toast } from 'sonner';

interface ISOInfo {
  filename: string;
  version: string;
  sha256: string;
  size_bytes: number;
  upload_date: string;
}

function ISOs() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  const { data: isos, isLoading, refetch } = useQuery<ISOInfo[]>({
    queryKey: ['isos'],
    queryFn: async () => {
      const res = await fetch('/api/v1/iso/list');
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error('Failed to fetch ISOs');
      }
      return res.json();
    },
  });

  const deleteISO = useMutation({
    mutationFn: async (filename: string) => {
      const token = localStorage.getItem('publish_token') || 'dev-token';
      const res = await fetch(`/api/v1/iso/${filename}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Failed to delete ISO');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isos'] });
      toast.success('ISO deleted successfully');
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error.message}`);
    },
  });

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.iso')) {
      toast.error('Please select an ISO file');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('iso', file);

    // Extract version from filename if possible
    const versionMatch = file.name.match(/quantix-kvm-agent-tools-(.+)\.iso/);
    if (versionMatch) {
      formData.append('version', versionMatch[1]);
    }

    try {
      const token = localStorage.getItem('publish_token') || 'dev-token';
      
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
        }
      });

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(xhr.responseText || 'Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        
        xhr.open('POST', '/api/v1/iso/publish');
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });

      toast.success('ISO uploaded successfully');
      queryClient.invalidateQueries({ queryKey: ['isos'] });
    } catch (error) {
      toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
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

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(label);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const getDownloadUrl = (filename: string) => {
    return `${window.location.origin}/api/v1/iso/download/${filename}`;
  };

  const getDirectDownloadUrl = () => {
    return `${window.location.origin}/api/v1/agent/iso`;
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-qx-text">Agent Tools ISOs</h1>
          <p className="text-qx-muted mt-1">Manage Agent Tools ISO images for VM installation</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-4 py-2 bg-qx-surface border border-qx-hover rounded-lg hover:bg-qx-hover transition-colors"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
          <label className="flex items-center gap-2 px-4 py-2 bg-qx-accent text-white rounded-lg hover:bg-qx-accent/80 transition-colors cursor-pointer">
            <Upload size={18} />
            Upload ISO
            <input
              ref={fileInputRef}
              type="file"
              accept=".iso"
              onChange={handleUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      {/* Upload Progress */}
      {isUploading && (
        <div className="mb-6 p-4 bg-qx-surface border border-qx-hover rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-qx-text font-medium">Uploading ISO...</span>
            <span className="text-qx-muted">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-qx-base rounded-full h-2">
            <div 
              className="bg-qx-accent h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Quick Download Links */}
      <div className="mb-6 p-4 bg-qx-surface border border-qx-hover rounded-xl">
        <h3 className="text-lg font-semibold text-qx-text mb-3">Quick Download URLs</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-qx-base rounded-lg">
            <div>
              <p className="text-sm font-medium text-qx-text">Latest ISO (Direct Download)</p>
              <p className="text-xs text-qx-muted font-mono">{getDirectDownloadUrl()}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => copyToClipboard(getDirectDownloadUrl(), 'direct')}
                className="p-2 hover:bg-qx-hover rounded-lg transition-colors"
                title="Copy URL"
              >
                {copiedUrl === 'direct' ? (
                  <Check size={16} className="text-green-400" />
                ) : (
                  <Copy size={16} className="text-qx-muted" />
                )}
              </button>
              <a
                href={getDirectDownloadUrl()}
                className="p-2 hover:bg-qx-hover rounded-lg transition-colors"
                title="Open in new tab"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} className="text-qx-muted" />
              </a>
            </div>
          </div>
          <p className="text-xs text-qx-muted px-1">
            QHCI hosts automatically download from this URL when mounting the Agent Tools ISO to VMs.
          </p>
        </div>
      </div>

      {/* ISOs List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="animate-spin text-qx-muted" size={32} />
        </div>
      ) : !isos || isos.length === 0 ? (
        <div className="text-center py-16 bg-qx-surface border border-qx-hover rounded-xl">
          <Disc size={48} className="mx-auto text-qx-muted mb-4" />
          <p className="text-qx-muted mb-2">No ISOs uploaded yet</p>
          <p className="text-sm text-qx-muted">
            Build and publish an ISO with: <code className="bg-qx-base px-2 py-1 rounded">./scripts/publish-agent-iso.sh</code>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {isos.map((iso, index) => (
            <div
              key={iso.filename}
              className="bg-qx-surface border border-qx-hover rounded-xl overflow-hidden"
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${index === 0 ? 'bg-qx-accent/20' : 'bg-qx-base'}`}>
                    <Disc size={24} className={index === 0 ? 'text-qx-accent' : 'text-qx-muted'} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-qx-text">
                        v{iso.version}
                      </span>
                      {index === 0 && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">
                          Latest
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-qx-muted font-mono">{iso.filename}</p>
                    <div className="flex items-center gap-4 text-sm text-qx-muted mt-1">
                      <span className="flex items-center gap-1">
                        <HardDrive size={14} />
                        {formatBytes(iso.size_bytes)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {formatDistanceToNow(new Date(iso.upload_date), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyToClipboard(getDownloadUrl(iso.filename), iso.filename)}
                    className="p-2 hover:bg-qx-hover rounded-lg transition-colors"
                    title="Copy Download URL"
                  >
                    {copiedUrl === iso.filename ? (
                      <Check size={18} className="text-green-400" />
                    ) : (
                      <Copy size={18} className="text-qx-muted" />
                    )}
                  </button>
                  <a
                    href={`/api/v1/iso/download/${iso.filename}`}
                    className="flex items-center gap-2 px-4 py-2 bg-qx-accent/20 text-qx-accent rounded-lg hover:bg-qx-accent/30 transition-colors"
                  >
                    <Download size={18} />
                    Download
                  </a>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${iso.filename}?`)) {
                        deleteISO.mutate(iso.filename);
                      }
                    }}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                    title="Delete ISO"
                  >
                    <Trash2 size={18} className="text-red-400" />
                  </button>
                </div>
              </div>

              {/* SHA256 */}
              {iso.sha256 && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 p-2 bg-qx-base rounded-lg">
                    <span className="text-xs text-qx-muted">SHA256:</span>
                    <code className="text-xs text-qx-text font-mono flex-1 truncate">{iso.sha256}</code>
                    <button
                      onClick={() => copyToClipboard(iso.sha256, `sha256-${iso.filename}`)}
                      className="p-1 hover:bg-qx-hover rounded transition-colors"
                      title="Copy SHA256"
                    >
                      {copiedUrl === `sha256-${iso.filename}` ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} className="text-qx-muted" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Usage Instructions */}
      <div className="mt-8 p-4 bg-qx-surface border border-qx-hover rounded-xl">
        <h3 className="text-lg font-semibold text-qx-text mb-3">Usage</h3>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-qx-muted mb-1">Build and publish a new ISO:</p>
            <code className="block bg-qx-base px-3 py-2 rounded text-qx-text font-mono">
              ./scripts/publish-agent-iso.sh
            </code>
          </div>
          <div>
            <p className="text-qx-muted mb-1">Download latest ISO via curl:</p>
            <code className="block bg-qx-base px-3 py-2 rounded text-qx-text font-mono">
              curl -O {getDirectDownloadUrl()}
            </code>
          </div>
          <div>
            <p className="text-qx-muted mb-1">Mount to VM from QHCI Host UI:</p>
            <p className="text-qx-text">
              Go to VM Details → Actions → Mount Agent Tools ISO
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ISOs;
