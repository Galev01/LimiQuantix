/**
 * Network Configuration Page
 */

import { useState } from 'react';
import { Card } from '@/components/ui';
import { useNetworkInterfaces, useDnsConfig, useHostname } from '@/hooks/useNetwork';
import { Network as NetworkIcon, Wifi, Globe, Server, Plus, Settings } from 'lucide-react';
import { InterfaceCard } from '@/components/network/InterfaceCard';
import { DnsConfigModal } from '@/components/network/DnsConfigModal';
import { HostnameModal } from '@/components/network/HostnameModal';
import { CreateBridgeModal } from '@/components/network/CreateBridgeModal';

export function Network() {
  const { data: interfaces, isLoading: interfacesLoading } = useNetworkInterfaces();
  const { data: dnsConfig } = useDnsConfig();
  const { data: hostnameConfig } = useHostname();
  
  const [showDnsModal, setShowDnsModal] = useState(false);
  const [showHostnameModal, setShowHostnameModal] = useState(false);
  const [showBridgeModal, setShowBridgeModal] = useState(false);

  if (interfacesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-neonBlue mx-auto mb-4"></div>
          <p className="text-text-muted">Loading network configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <NetworkIcon className="w-7 h-7 text-neonBlue" />
            Network Configuration
          </h1>
          <p className="text-text-muted mt-1">
            Manage network interfaces, DNS, and hostname
          </p>
        </div>
        
        <button
          onClick={() => setShowBridgeModal(true)}
          className="px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Bridge
        </button>
      </div>

      {/* Quick Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => setShowHostnameModal(true)}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Server className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-muted">Hostname</p>
              <p className="text-lg font-semibold text-text-primary">
                {hostnameConfig?.hostname || 'Not set'}
              </p>
            </div>
            <Settings className="w-4 h-4 text-text-muted" />
          </div>
        </Card>

        <Card className="p-4 cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => setShowDnsModal(true)}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <Globe className="w-5 h-5 text-green-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-muted">DNS Servers</p>
              <p className="text-lg font-semibold text-text-primary">
                {dnsConfig?.nameservers.length || 0} configured
              </p>
            </div>
            <Settings className="w-4 h-4 text-text-muted" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Wifi className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-text-muted">Interfaces</p>
              <p className="text-lg font-semibold text-text-primary">
                {interfaces?.interfaces.length || 0} total
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Network Interfaces */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Network Interfaces</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {interfaces?.interfaces.map((iface) => (
            <InterfaceCard key={iface.name} interface={iface} />
          ))}
        </div>
      </div>

      {/* Modals */}
      {showDnsModal && (
        <DnsConfigModal
          config={dnsConfig}
          onClose={() => setShowDnsModal(false)}
        />
      )}
      
      {showHostnameModal && (
        <HostnameModal
          hostname={hostnameConfig?.hostname || ''}
          onClose={() => setShowHostnameModal(false)}
        />
      )}
      
      {showBridgeModal && (
        <CreateBridgeModal
          interfaces={interfaces?.interfaces || []}
          onClose={() => setShowBridgeModal(false)}
        />
      )}
    </div>
  );
}
