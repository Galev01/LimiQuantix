/**
 * Connection Setup Component
 * 
 * Shown when the Host UI is not connected to a node daemon.
 * Allows the user to enter the URL of a remote node daemon.
 */

import { useState, useEffect } from 'react';
import { Server, Wifi, WifiOff, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Card, Button, Input, Label } from '@/components/ui';
import { getNodeConnection, setNodeConnection, testNodeConnection } from '@/api/client';
import { cn } from '@/lib/utils';

interface ConnectionSetupProps {
  onConnected?: () => void;
}

export function ConnectionSetup({ onConnected }: ConnectionSetupProps) {
  const [nodeUrl, setNodeUrl] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [recentConnections, setRecentConnections] = useState<Array<{ url: string; name?: string }>>([]);

  // Load recent connections from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('quantix-recent-connections');
      if (stored) {
        setRecentConnections(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load recent connections:', e);
    }
    
    // Pre-fill with current connection if any
    const current = getNodeConnection();
    if (current) {
      setNodeUrl(current.url);
      setNodeName(current.name || '');
    }
  }, []);

  const handleTest = async () => {
    if (!nodeUrl) return;
    
    setTesting(true);
    setTestResult(null);
    
    const result = await testNodeConnection(nodeUrl);
    setTestResult(result);
    setTesting(false);
  };

  const handleConnect = async () => {
    if (!nodeUrl) return;
    
    // Test first
    setTesting(true);
    setTestResult(null);
    
    const result = await testNodeConnection(nodeUrl);
    setTestResult(result);
    setTesting(false);
    
    if (result.success) {
      // Save connection
      const connection = {
        url: nodeUrl,
        name: nodeName || undefined,
        connected: true,
        lastConnected: new Date().toISOString(),
      };
      setNodeConnection(connection);
      
      // Add to recent connections
      const updated = [
        { url: nodeUrl, name: nodeName || undefined },
        ...recentConnections.filter(c => c.url !== nodeUrl),
      ].slice(0, 5);
      setRecentConnections(updated);
      localStorage.setItem('quantix-recent-connections', JSON.stringify(updated));
      
      // Notify parent
      onConnected?.();
      
      // Reload the page to reinitialize all API calls
      window.location.reload();
    }
  };

  const handleSelectRecent = (connection: { url: string; name?: string }) => {
    setNodeUrl(connection.url);
    setNodeName(connection.name || '');
    setTestResult(null);
  };

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 mb-4">
            <Server className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Connect to Node Daemon</h1>
          <p className="text-text-muted">
            Enter the URL of your Quantix-OS node daemon to manage it remotely.
          </p>
        </div>

        <Card className="space-y-6">
          {/* Connection Form */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="nodeUrl">Node Daemon URL</Label>
              <Input
                id="nodeUrl"
                value={nodeUrl}
                onChange={(e) => {
                  setNodeUrl(e.target.value);
                  setTestResult(null);
                }}
                placeholder="https://192.168.1.101:8443"
                className="font-mono"
              />
              <p className="text-xs text-text-muted mt-1">
                The HTTPS URL of the node daemon (e.g., https://hostname:8443)
              </p>
            </div>

            <div>
              <Label htmlFor="nodeName">Display Name (optional)</Label>
              <Input
                id="nodeName"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="My Ubuntu Server"
              />
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={cn(
              'p-4 rounded-lg flex items-start gap-3',
              testResult.success 
                ? 'bg-success/10 border border-success/20' 
                : 'bg-error/10 border border-error/20'
            )}>
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
              )}
              <div>
                <p className={cn(
                  'font-medium',
                  testResult.success ? 'text-success' : 'text-error'
                )}>
                  {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                </p>
                <p className="text-sm text-text-muted mt-1">{testResult.message}</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={!nodeUrl || testing}
              className="flex-1"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wifi className="w-4 h-4" />
              )}
              Test Connection
            </Button>
            <Button
              onClick={handleConnect}
              disabled={!nodeUrl || testing}
              className="flex-1"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Connect
            </Button>
          </div>

          {/* Recent Connections */}
          {recentConnections.length > 0 && (
            <div className="pt-4 border-t border-border">
              <p className="text-sm font-medium text-text-secondary mb-3">Recent Connections</p>
              <div className="space-y-2">
                {recentConnections.map((conn, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectRecent(conn)}
                    className={cn(
                      'w-full p-3 rounded-lg text-left transition-colors',
                      'bg-bg-base hover:bg-bg-hover border border-border',
                      nodeUrl === conn.url && 'border-accent bg-accent/5'
                    )}
                  >
                    <p className="font-medium text-text-primary">
                      {conn.name || 'Unnamed Node'}
                    </p>
                    <p className="text-sm text-text-muted font-mono">{conn.url}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Help Text */}
        <div className="mt-6 p-4 bg-bg-surface rounded-lg border border-border">
          <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-text-muted" />
            Not seeing your node?
          </h3>
          <ul className="text-sm text-text-muted space-y-1">
            <li>• Make sure the node daemon is running on your Quantix-OS host</li>
            <li>• Check that port 8443 is accessible (firewall settings)</li>
            <li>• Verify both machines are on the same network</li>
            <li>• For HTTPS with self-signed certs, visit the URL directly first to accept the certificate</li>
            <li>• Try HTTP first: <code className="bg-bg-base px-1 rounded">http://192.168.x.x:8080</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
