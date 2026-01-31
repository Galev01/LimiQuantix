/**
 * OVS Status Card - Displays Open vSwitch status and port bindings
 */

import { useState } from 'react';
import { Card } from '@/components/ui';
import {
  CheckCircle,
  XCircle,
  Network,
  Layers,
  Plug,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface OVSBridge {
  name: string;
  uuid: string;
  ports: OVSPort[];
  controller?: string;
  failMode?: string;
  datapath?: string;
}

interface OVSPort {
  name: string;
  uuid: string;
  type: string;
  mac?: string;
  ofport: number;
  vmId?: string;
  vmName?: string;
  status: 'up' | 'down' | 'unknown';
  rxBytes?: number;
  txBytes?: number;
}

interface OVSStatus {
  version: string;
  isRunning: boolean;
  bridges: OVSBridge[];
  ovnControllerConnected: boolean;
}

// Mock data for demonstration - in production, this would come from API
const mockStatus: OVSStatus = {
  version: '2.17.0',
  isRunning: true,
  ovnControllerConnected: true,
  bridges: [
    {
      name: 'br-int',
      uuid: 'uuid-1',
      controller: 'tcp:127.0.0.1:6653',
      failMode: 'secure',
      datapath: 'system',
      ports: [
        {
          name: 'br-int',
          uuid: 'port-1',
          type: 'internal',
          ofport: 65534,
          status: 'up',
        },
        {
          name: 'vm-port-1',
          uuid: 'port-2',
          type: '',
          mac: 'fa:16:3e:aa:bb:cc',
          ofport: 1,
          vmId: 'vm-123',
          vmName: 'ubuntu-server-1',
          status: 'up',
          rxBytes: 1024 * 1024 * 150,
          txBytes: 1024 * 1024 * 80,
        },
        {
          name: 'vm-port-2',
          uuid: 'port-3',
          type: '',
          mac: 'fa:16:3e:dd:ee:ff',
          ofport: 2,
          vmId: 'vm-456',
          vmName: 'centos-db-1',
          status: 'up',
          rxBytes: 1024 * 1024 * 300,
          txBytes: 1024 * 1024 * 200,
        },
      ],
    },
    {
      name: 'br-ext',
      uuid: 'uuid-2',
      controller: 'tcp:127.0.0.1:6653',
      failMode: 'standalone',
      datapath: 'system',
      ports: [
        {
          name: 'br-ext',
          uuid: 'port-4',
          type: 'internal',
          ofport: 65534,
          status: 'up',
        },
        {
          name: 'eth0',
          uuid: 'port-5',
          type: '',
          ofport: 1,
          status: 'up',
        },
      ],
    },
  ],
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function OVSStatusCard() {
  const [status] = useState<OVSStatus>(mockStatus);
  const [selectedBridge, setSelectedBridge] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const totalPorts = status.bridges.reduce((acc, b) => acc + b.ports.length, 0);
  const vmPorts = status.bridges.reduce(
    (acc, b) => acc + b.ports.filter(p => p.vmId).length,
    0
  );

  return (
    <Card className="p-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border-default">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Layers className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Open vSwitch</h3>
              <p className="text-sm text-text-muted">OVS v{status.version}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status.isRunning ? (
              <span className="flex items-center gap-1 px-2 py-1 bg-green-500/10 text-green-400 rounded text-sm">
                <CheckCircle className="w-4 h-4" />
                Running
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-1 bg-red-500/10 text-red-400 rounded text-sm">
                <XCircle className="w-4 h-4" />
                Stopped
              </span>
            )}
            <button
              onClick={handleRefresh}
              className="p-2 hover:bg-bg-elevated rounded-lg transition-colors"
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 text-text-muted ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4 p-4 border-b border-border-default bg-bg-base">
        <div className="text-center">
          <div className="text-2xl font-bold text-text-primary">{status.bridges.length}</div>
          <div className="text-sm text-text-muted">Bridges</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-text-primary">{totalPorts}</div>
          <div className="text-sm text-text-muted">Total Ports</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-text-primary">{vmPorts}</div>
          <div className="text-sm text-text-muted">VM Ports</div>
        </div>
      </div>

      {/* OVN Controller Status */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between">
        <span className="text-sm text-text-muted">OVN Controller</span>
        {status.ovnControllerConnected ? (
          <span className="flex items-center gap-1 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            Connected
          </span>
        ) : (
          <span className="flex items-center gap-1 text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4" />
            Disconnected
          </span>
        )}
      </div>

      {/* Bridge List */}
      <div className="divide-y divide-border-default">
        {status.bridges.map((bridge) => (
          <div key={bridge.uuid}>
            {/* Bridge Header */}
            <button
              onClick={() => setSelectedBridge(selectedBridge === bridge.name ? null : bridge.name)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-bg-elevated transition-colors"
            >
              <div className="flex items-center gap-3">
                <Network className="w-5 h-5 text-neonBlue" />
                <div className="text-left">
                  <div className="font-medium text-text-primary">{bridge.name}</div>
                  <div className="text-xs text-text-muted">
                    {bridge.ports.length} ports · {bridge.failMode || 'standalone'} mode
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-text-muted">
                {bridge.controller && (
                  <span className="px-2 py-1 bg-bg-base rounded text-xs">
                    {bridge.controller}
                  </span>
                )}
              </div>
            </button>

            {/* Expanded Port List */}
            {selectedBridge === bridge.name && (
              <div className="bg-bg-base border-t border-border-default">
                {bridge.ports.map((port) => (
                  <div
                    key={port.uuid}
                    className="px-6 py-3 flex items-center justify-between border-b border-border-default last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <Plug className={`w-4 h-4 ${port.status === 'up' ? 'text-green-400' : 'text-text-muted'}`} />
                      <div>
                        <div className="text-sm font-medium text-text-primary">{port.name}</div>
                        <div className="text-xs text-text-muted">
                          {port.type || 'system'} · ofport {port.ofport}
                          {port.mac && ` · ${port.mac}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {port.vmName && (
                        <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded text-xs">
                          {port.vmName}
                        </span>
                      )}
                      {port.rxBytes !== undefined && (
                        <div className="text-xs text-text-muted text-right">
                          <div>↓ {formatBytes(port.rxBytes)}</div>
                          <div>↑ {formatBytes(port.txBytes || 0)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
