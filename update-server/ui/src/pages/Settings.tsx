import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Settings as SettingsIcon, 
  Key, 
  Server, 
  Save,
  Eye,
  EyeOff,
  FolderGit2,
  CheckCircle2,
  Shield,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

interface ServerConfig {
  server: {
    listen_addr: string;
    release_dir: string;
    git_repo_path: string;
    ui_path: string;
  };
  signing: {
    enabled: boolean;
    key_id: string;
    public_key: string;
  };
  git: {
    branch: string;
    commit: string;
    status: string;
  };
}

function Settings() {
  const [publishToken, setPublishToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: serverConfig, isLoading, refetch } = useQuery<ServerConfig>({
    queryKey: ['config'],
    queryFn: async () => {
      const res = await fetch('/api/v1/admin/config');
      if (!res.ok) throw new Error('Failed to fetch config');
      return res.json();
    },
  });

  useEffect(() => {
    // Load saved token from localStorage
    const savedToken = localStorage.getItem('publish_token');
    if (savedToken) {
      setPublishToken(savedToken);
    }
  }, []);

  const saveToken = () => {
    localStorage.setItem('publish_token', publishToken);
    setSaved(true);
    toast.success('Token saved to browser');
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-qx-text">Settings</h1>
        <p className="text-qx-muted mt-1">Configure the update server</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Authentication */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Key className="text-qx-accent" size={24} />
            <h2 className="text-lg font-bold text-qx-text">Authentication</h2>
          </div>

          <div className="mb-4">
            <label className="block text-sm text-qx-muted mb-2">
              Publish Token
            </label>
            <p className="text-xs text-qx-muted mb-3">
              This token is used to authenticate when publishing updates. Store it securely.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={publishToken}
                  onChange={(e) => setPublishToken(e.target.value)}
                  placeholder="Enter your publish token"
                  className="w-full px-4 py-2 pr-10 bg-qx-base border border-qx-hover rounded-lg text-qx-text placeholder:text-qx-muted focus:outline-none focus:ring-2 focus:ring-qx-accent"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-qx-muted hover:text-qx-text"
                >
                  {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button
                onClick={saveToken}
                className="flex items-center gap-2 px-4 py-2 bg-qx-accent text-white rounded-lg hover:bg-qx-accent/80 transition-colors"
              >
                {saved ? <CheckCircle2 size={18} /> : <Save size={18} />}
                {saved ? 'Saved!' : 'Save'}
              </button>
            </div>
          </div>
        </div>

        {/* Server Info */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Server className="text-purple-400" size={24} />
              <h2 className="text-lg font-bold text-qx-text">Server Configuration</h2>
            </div>
            <button
              onClick={() => refetch()}
              className="p-2 hover:bg-qx-hover rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={18} className={`text-qx-muted ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="animate-spin text-qx-muted" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-qx-muted mb-2">Listen Address</label>
                <input
                  type="text"
                  value={serverConfig?.server.listen_addr || ''}
                  readOnly
                  className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm text-qx-muted mb-2">Releases Directory</label>
                <input
                  type="text"
                  value={serverConfig?.server.release_dir || ''}
                  readOnly
                  className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm text-qx-muted mb-2">UI Path</label>
                <input
                  type="text"
                  value={serverConfig?.server.ui_path || ''}
                  readOnly
                  className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed"
                />
              </div>
            </div>
          )}
        </div>

        {/* Signing Status */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Shield className={serverConfig?.signing.enabled ? "text-green-400" : "text-qx-muted"} size={24} />
            <h2 className="text-lg font-bold text-qx-text">Cryptographic Signing</h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${serverConfig?.signing.enabled ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-qx-text">
                {serverConfig?.signing.enabled ? 'Signing Enabled' : 'Signing Disabled'}
              </span>
            </div>

            {serverConfig?.signing.enabled && (
              <>
                <div>
                  <label className="block text-sm text-qx-muted mb-2">Key ID</label>
                  <input
                    type="text"
                    value={serverConfig.signing.key_id || ''}
                    readOnly
                    className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm text-qx-muted mb-2">Public Key (embed in agents)</label>
                  <input
                    type="text"
                    value={serverConfig.signing.public_key || ''}
                    readOnly
                    className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed font-mono text-xs"
                  />
                </div>
              </>
            )}

            {!serverConfig?.signing.enabled && (
              <p className="text-sm text-qx-muted">
                Set SIGNING_PRIVATE_KEY environment variable to enable manifest signing.
              </p>
            )}
          </div>
        </div>

        {/* Git Integration */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <FolderGit2 className="text-green-400" size={24} />
            <h2 className="text-lg font-bold text-qx-text">Git Integration</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-qx-muted mb-2">Repository Path</label>
              <input
                type="text"
                value={serverConfig?.server.git_repo_path || ''}
                readOnly
                className="w-full px-4 py-2 bg-qx-base border border-qx-hover rounded-lg text-qx-muted cursor-not-allowed"
              />
            </div>

            {serverConfig?.git && (
              <div className="flex items-center gap-4 p-3 bg-qx-base rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-qx-muted">Branch:</span>
                  <span className="text-sm text-qx-text font-medium">{serverConfig.git.branch}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-qx-muted">Commit:</span>
                  <span className="text-sm text-qx-accent font-mono">{serverConfig.git.commit}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${serverConfig.git.status === 'clean' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-sm text-qx-text capitalize">{serverConfig.git.status}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* API Reference */}
        <div className="bg-qx-surface border border-qx-hover rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <SettingsIcon className="text-yellow-400" size={24} />
            <h2 className="text-lg font-bold text-qx-text">API Reference</h2>
          </div>

          <div className="space-y-3">
            <ApiEndpoint method="GET" path="/api/v1/health" description="Health check" />
            <ApiEndpoint method="GET" path="/api/v1/channels" description="List channels" />
            <ApiEndpoint method="GET" path="/api/v1/{product}/manifest" description="Get latest manifest" />
            <ApiEndpoint method="GET" path="/api/v1/{product}/releases" description="List all releases" />
            <ApiEndpoint method="GET" path="/api/v1/{product}/releases/{version}/{artifact}" description="Download artifact" />
            <ApiEndpoint method="POST" path="/api/v1/{product}/publish" description="Publish release" badge="Auth" />
            <ApiEndpoint method="POST" path="/api/v1/admin/git-pull" description="Pull latest code" badge="Admin" />
            <ApiEndpoint method="POST" path="/api/v1/admin/build" description="Build and publish" badge="Admin" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ApiEndpointProps {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  description: string;
  badge?: string;
}

function ApiEndpoint({ method, path, description, badge }: ApiEndpointProps) {
  const methodColors = {
    GET: 'bg-green-500/20 text-green-400',
    POST: 'bg-blue-500/20 text-blue-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-qx-base rounded-lg">
      <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${methodColors[method]}`}>
        {method}
      </span>
      <code className="flex-1 text-sm text-qx-text font-mono">{path}</code>
      {badge && (
        <span className="px-2 py-0.5 bg-qx-accent/20 text-qx-accent rounded text-xs">
          {badge}
        </span>
      )}
      <span className="text-sm text-qx-muted">{description}</span>
    </div>
  );
}

export default Settings;
