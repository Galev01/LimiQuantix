/**
 * Network Interface Card Component
 */

import { useState } from 'react';
import { Card } from '@/components/ui';
import { NetworkInterface } from '@/api/network';
import { Wifi, WifiOff, Settings, Activity } from 'lucide-react';
import { InterfaceConfigModal } from './InterfaceConfigModal';

interface InterfaceCardProps {
  interface: NetworkInterface;
}

export function InterfaceCard({ interface: iface }: InterfaceCardProps) {
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  const isUp = iface.state === 'up';
  const hasIp = iface.ip_addresses.length > 0;

  return (
    <>
      <Card className="p-4 hover:bg-bg-elevated transition-colors">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isUp ? 'bg-green-500/10' : 'bg-gray-500/10'}`}>
              {isUp ? (
                <Wifi className="w-5 h-5 text-green-400" />
              ) : (
                <WifiOff className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{iface.name}</h3>
              <p className="text-sm text-text-muted capitalize">{iface.type}</p>
            </div>
          </div>
          
          <button
            onClick={() => setShowConfigModal(true)}
            className="p-2 hover:bg-bg-base rounded-lg transition-colors"
            title="Configure interface"
          >
            <Settings className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="space-y-2">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">Status</span>
            <span className={`text-sm font-medium ${isUp ? 'text-green-400' : 'text-gray-400'}`}>
              {isUp ? 'UP' : 'DOWN'}
            </span>
          </div>

          {/* IP Addresses */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">IP Address</span>
            <span className="text-sm font-mono text-text-primary">
              {hasIp ? iface.ip_addresses[0] : 'Not configured'}
            </span>
          </div>

          {/* MAC Address */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">MAC Address</span>
            <span className="text-sm font-mono text-text-primary">
              {iface.mac_address}
            </span>
          </div>

          {/* MTU */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-muted">MTU</span>
            <span className="text-sm text-text-primary">{iface.mtu}</span>
          </div>

          {/* Speed */}
          {iface.speed_mbps && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-muted flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Speed
              </span>
              <span className="text-sm text-text-primary">{iface.speed_mbps} Mbps</span>
            </div>
          )}
        </div>
      </Card>

      {showConfigModal && (
        <InterfaceConfigModal
          interface={iface}
          onClose={() => setShowConfigModal(false)}
        />
      )}
    </>
  );
}
