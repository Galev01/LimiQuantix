import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Upload, 
  FileUp, 
  Package, 
  Terminal,
  XCircle,
  Loader2,
  AlertTriangle,
  FolderGit2
} from 'lucide-react';
import { toast } from 'sonner';

interface PublishForm {
  product: 'quantix-os' | 'quantix-vdc';
  channel: 'dev' | 'beta' | 'stable';
  version: string;
  releaseNotes: string;
}

interface GitPullResult {
  success: boolean;
  message: string;
  branch?: string;
  commit?: string;
}

function Publish() {
  const [form, setForm] = useState<PublishForm>({
    product: 'quantix-os',
    channel: 'dev',
    version: '',
    releaseNotes: '',
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manifestInputRef = useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  // Git pull mutation
  const gitPull = useMutation({
    mutationFn: async (): Promise<GitPullResult> => {
      const token = localStorage.getItem('publish_token') || 'dev-token';
      const res = await fetch('/api/v1/admin/git-pull', { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Git pull failed');
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Git pull successful: ${data.message}`);
      } else {
        toast.error(`Git pull failed: ${data.message}`);
      }
    },
    onError: (error) => {
      toast.error(`Git pull error: ${error.message}`);
    },
  });

  // Build mutation
  const buildRelease = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('publish_token') || 'dev-token';
      const res = await fetch('/api/v1/admin/build', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          product: form.product,
          version: form.version,
          channel: form.channel,
        }),
      });
      if (!res.ok) throw new Error('Build failed');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Build started successfully');
      queryClient.invalidateQueries({ queryKey: ['releases'] });
    },
    onError: (error) => {
      toast.error(`Build failed: ${error.message}`);
    },
  });

  // Publish mutation
  const publishRelease = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      
      // Create manifest if not uploaded
      if (manifestFile) {
        formData.append('manifest', manifestFile);
      } else {
        // Auto-generate manifest
        const manifest = {
          product: form.product,
          version: form.version,
          channel: form.channel,
          release_date: new Date().toISOString(),
          update_type: 'component',
          components: selectedFiles.map(file => ({
            name: file.name.replace('.tar.zst', ''),
            version: form.version,
            artifact: file.name,
            sha256: 'pending', // Will be calculated server-side
            size_bytes: file.size,
            install_path: getInstallPath(file.name),
            restart_service: getRestartService(file.name),
          })),
          release_notes: form.releaseNotes,
        };
        
        const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
        formData.append('manifest', manifestBlob, 'manifest.json');
      }

      // Add artifact files
      selectedFiles.forEach(file => {
        formData.append(file.name, file);
      });

      const token = localStorage.getItem('publish_token') || 'dev-token';
      const res = await fetch(`/api/v1/${form.product}/publish`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || 'Publish failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Release published successfully!');
      queryClient.invalidateQueries({ queryKey: ['releases'] });
      // Reset form
      setSelectedFiles([]);
      setManifestFile(null);
      setForm(f => ({ ...f, version: '', releaseNotes: '' }));
    },
    onError: (error) => {
      toast.error(`Publish failed: ${error.message}`);
    },
  });

  const getInstallPath = (filename: string): string => {
    if (filename.includes('qx-node')) return '/data/bin/qx-node';
    if (filename.includes('qx-console')) return '/data/bin/qx-console';
    if (filename.includes('host-ui')) return '/data/share/quantix-host-ui';
    if (filename.includes('controlplane')) return '/usr/bin/quantix-controlplane';
    if (filename.includes('dashboard')) return '/usr/share/quantix-vdc/dashboard';
    return `/data/bin/${filename.replace('.tar.zst', '')}`;
  };

  const getRestartService = (filename: string): string | null => {
    if (filename.includes('qx-node')) return 'quantix-node';
    if (filename.includes('qx-console')) return 'quantix-console';
    if (filename.includes('controlplane')) return 'quantix-controlplane';
    return null;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const handleManifestSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setManifestFile(file);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const canPublish = form.version && selectedFiles.length > 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-qx-text">Publish Update</h1>
        <p className="text-qx-muted mt-1">Build and publish new releases</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => gitPull.mutate()}
          disabled={gitPull.isPending}
          className="flex items-center gap-4 p-4 bg-qx-surface border border-qx-hover rounded-xl hover:bg-qx-elevated transition-colors disabled:opacity-50"
        >
          {gitPull.isPending ? (
            <Loader2 className="animate-spin text-qx-accent" size={24} />
          ) : (
            <FolderGit2 className="text-qx-accent" size={24} />
          )}
          <div className="text-left">
            <p className="font-semibold text-qx-text">Git Pull</p>
            <p className="text-sm text-qx-muted">Pull latest code from repository</p>
          </div>
        </button>

        <button
          onClick={() => buildRelease.mutate()}
          disabled={buildRelease.isPending || !form.version}
          className="flex items-center gap-4 p-4 bg-qx-surface border border-qx-hover rounded-xl hover:bg-qx-elevated transition-colors disabled:opacity-50"
        >
          {buildRelease.isPending ? (
            <Loader2 className="animate-spin text-purple-400" size={24} />
          ) : (
            <Terminal className="text-purple-400" size={24} />
          )}
          <div className="text-left">
            <p className="font-semibold text-qx-text">Build & Publish</p>
            <p className="text-sm text-qx-muted">Build from source and publish</p>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <h2 className="text-lg font-bold text-qx-text mb-4">Release Details</h2>

          {/* Product */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">Product</label>
            <div className="flex bg-qx-base border border-qx-hover rounded-lg overflow-hidden">
              <button
                onClick={() => setForm(f => ({ ...f, product: 'quantix-os' }))}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  form.product === 'quantix-os'
                    ? 'bg-qx-accent text-white'
                    : 'text-qx-muted hover:text-qx-text'
                }`}
              >
                Quantix-OS
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, product: 'quantix-vdc' }))}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  form.product === 'quantix-vdc'
                    ? 'bg-qx-accent text-white'
                    : 'text-qx-muted hover:text-qx-text'
                }`}
              >
                Quantix-vDC
              </button>
            </div>
          </div>

          {/* Channel */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">Channel</label>
            <select
              value={form.channel}
              onChange={(e) => setForm(f => ({ ...f, channel: e.target.value as PublishForm['channel'] }))}
              className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-text focus:outline-none focus:ring-2 focus:ring-qx-accent"
            >
              <option value="dev">Dev</option>
              <option value="beta">Beta</option>
              <option value="stable">Stable</option>
            </select>
          </div>

          {/* Version */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">Version *</label>
            <input
              type="text"
              value={form.version}
              onChange={(e) => setForm(f => ({ ...f, version: e.target.value }))}
              placeholder="e.g., 0.0.5"
              className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-text placeholder:text-qx-muted focus:outline-none focus:ring-2 focus:ring-qx-accent"
            />
          </div>

          {/* Release Notes */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">Release Notes</label>
            <textarea
              value={form.releaseNotes}
              onChange={(e) => setForm(f => ({ ...f, releaseNotes: e.target.value }))}
              placeholder="Describe what's new in this release..."
              rows={4}
              className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-text placeholder:text-qx-muted focus:outline-none focus:ring-2 focus:ring-qx-accent resize-none"
            />
          </div>
        </div>

        {/* File Upload */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <h2 className="text-lg font-bold text-qx-text mb-4">Artifacts</h2>

          {/* Manifest Upload */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">
              Manifest (optional - will auto-generate if not provided)
            </label>
            <input
              type="file"
              ref={manifestInputRef}
              accept=".json"
              onChange={handleManifestSelect}
              className="hidden"
            />
            <button
              onClick={() => manifestInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-qx-hover rounded-lg hover:border-qx-accent hover:bg-qx-elevated transition-colors"
            >
              <FileUp size={18} className="text-qx-muted" />
              <span className="text-qx-muted">
                {manifestFile ? manifestFile.name : 'Upload manifest.json'}
              </span>
            </button>
          </div>

          {/* Component Files */}
          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">
              Component Artifacts (*.tar.zst)
            </label>
            <input
              type="file"
              ref={fileInputRef}
              accept=".tar.zst,.zst"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-qx-hover rounded-lg hover:border-qx-accent hover:bg-qx-elevated transition-colors"
            >
              <Upload size={24} className="text-qx-muted" />
              <span className="text-qx-muted">Click to select files or drag and drop</span>
            </button>
          </div>

          {/* Selected Files */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-qx-base rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Package size={18} className="text-qx-accent" />
                    <div>
                      <p className="text-sm font-medium text-qx-text">{file.name}</p>
                      <p className="text-xs text-qx-muted">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="p-1 hover:bg-red-500/20 rounded transition-colors"
                  >
                    <XCircle size={18} className="text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Publish Button */}
          <button
            onClick={() => publishRelease.mutate()}
            disabled={!canPublish || publishRelease.isPending}
            className="w-full mt-6 flex items-center justify-center gap-2 px-6 py-3 bg-qx-accent text-white rounded-lg font-semibold hover:bg-qx-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {publishRelease.isPending ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <Upload size={20} />
                Publish Release
              </>
            )}
          </button>

          {!canPublish && (
            <p className="text-center text-sm text-qx-muted mt-2">
              <AlertTriangle size={14} className="inline mr-1" />
              Version and at least one artifact required
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Publish;
