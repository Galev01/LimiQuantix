/**
 * VMNetworkPanel - Network interfaces panel with agent data
 * 
 * Displays VM network interfaces from both:
 * 1. VM spec (configured NICs)
 * 2. Guest agent (live network stats)
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Network,
  RefreshCw,
  Loader2,
  ArrowDown,
  ArrowUp,
  Wifi,
  WifiOff,
  Plus,
  Trash2,
  Info,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface AgentNetworkInterface {
  name: string;
  macAddress: string;
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  isUp: boolean;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
}

interface VMNic {
  id: string;
  networkId: string;
  macAddress?: string;
}

interface VMNetworkPanelProps {
  vmId: string;
  vmState: string;
  nics: VMNic[];
  ipAddresses: string[];
  onAddNIC: () => void;
  onRemoveNIC: (nicId: string) => void;
  className?: string;
}

// Format bytes to human readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// Format large numbers with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function VMNetworkPanel({
  vmId,
  vmState,
  nics,
  ipAddresses,
  onAddNIC,
  onRemoveNIC,
  className,
}: VMNetworkPanelProps) {
  const [agentInterfaces, setAgentInterfaces] = useState<AgentNetworkInterface[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAgentData, setHasAgentData] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchAgentNetworkData = useCallback(async () => {
    if (vmState !== 'RUNNING') {
      setAgentInterfaces([]);
      setHasAgentData(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/vms/${vmId}/agent/ping`);
      if (response.ok) {
        const data = await response.json();
        if (data.connected && data.networkInterfaces && data.networkInterfaces.length > 0) {
          setAgentInterfaces(data.networkInterfaces);
          setHasAgentData(true);
          setLastUpdate(new Date());
        } else {
          setAgentInterfaces([]);
          setHasAgentData(false);
        }
      }
    } catch {
      // Agent not available
      setAgentInterfaces([]);
      setHasAgentData(false);
    } finally {
      setIsLoading(false);
    }
  }, [vmId, vmState]);

  useEffect(() => {
    fetchAgentNetworkData();
    
    // Poll every 10 seconds if VM is running
    if (vmState === 'RUNNING') {
      const interval = setInterval(fetchAgentNetworkData, 10000);
      return () => clearInterval(interval);
    }
  }, [fetchAgentNetworkData, vmState]);

  // Match agent interfaces with configured NICs by MAC address
  const getAgentDataForNic = (nic: VMNic, index: number): AgentNetworkInterface | undefined => {
    if (!hasAgentData || !nic.macAddress) return undefined;
    
    // Try to match by MAC address
    const macLower = nic.macAddress.toLowerCase();
    return agentInterfaces.find(iface => 
      iface.macAddress.toLowerCase() === macLower
    );
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Configured NICs Table */}
      <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-text-primary">Network Interfaces</h3>
            {hasAgentData && (
              <Badge variant="success" size="sm">
                Agent Connected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-xs text-text-muted">
                Updated: {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchAgentNetworkData}
              disabled={isLoading || vmState !== 'RUNNING'}
            >
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={onAddNIC}>
              <Plus className="w-4 h-4" />
              Add NIC
            </Button>
          </div>
        </div>

        {nics.length === 0 ? (
          <div className="text-center py-12">
            <Network className="w-12 h-12 mx-auto text-text-muted mb-4" />
            <h4 className="text-lg font-medium text-text-primary mb-2">No Network Interfaces</h4>
            <p className="text-text-muted mb-4">
              This VM has no network interfaces
            </p>
            <Button size="sm" onClick={onAddNIC}>
              <Network className="w-4 h-4" />
              Add NIC
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-elevated/50">
              <tr className="text-xs font-medium text-text-muted uppercase">
                <th className="px-6 py-3 text-left">Device</th>
                <th className="px-6 py-3 text-left">Network</th>
                <th className="px-6 py-3 text-left">MAC Address</th>
                <th className="px-6 py-3 text-left">IP Address</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {nics.map((nic, index) => {
                const agentData = getAgentDataForNic(nic, index);
                const displayIp = agentData?.ipv4Addresses?.[0] || ipAddresses[index] || '—';
                
                return (
                  <tr key={nic.id} className="hover:bg-bg-hover">
                    <td className="px-6 py-4 text-sm text-text-primary font-mono">
                      eth{index}
                      {agentData && (
                        <span className="text-text-muted ml-2 text-xs">
                          ({agentData.name})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary">{nic.networkId}</td>
                    <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                      {nic.macAddress || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                      {displayIp}
                      {agentData && agentData.ipv4Addresses.length > 1 && (
                        <span className="text-text-muted ml-1">
                          (+{agentData.ipv4Addresses.length - 1})
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {agentData ? (
                        <div className="flex items-center gap-1.5">
                          {agentData.isUp ? (
                            <Wifi className="w-4 h-4 text-success" />
                          ) : (
                            <WifiOff className="w-4 h-4 text-error" />
                          )}
                          <span className={cn(
                            'text-xs font-medium',
                            agentData.isUp ? 'text-success' : 'text-error'
                          )}>
                            {agentData.isUp ? 'Up' : 'Down'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemoveNIC(nic.id)}
                        disabled={index === 0}
                        title={index === 0 ? 'Cannot remove primary NIC' : 'Remove NIC'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Agent Network Statistics */}
      {hasAgentData && agentInterfaces.length > 0 && (
        <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold text-text-primary">Network Statistics</h3>
              <span className="text-xs text-text-muted">(from Quantix Agent)</span>
            </div>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agentInterfaces.map((iface) => (
                <motion.div
                  key={iface.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-bg-base rounded-lg border border-border p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-accent" />
                      <span className="font-mono text-sm font-medium text-text-primary">
                        {iface.name}
                      </span>
                    </div>
                    <Badge 
                      variant={iface.isUp ? 'success' : 'error'} 
                      size="sm"
                    >
                      {iface.isUp ? 'Up' : 'Down'}
                    </Badge>
                  </div>
                  
                  <div className="space-y-2 text-xs">
                    {/* MAC Address */}
                    <div className="flex justify-between">
                      <span className="text-text-muted">MAC</span>
                      <span className="font-mono text-text-secondary">{iface.macAddress}</span>
                    </div>
                    
                    {/* IP Addresses */}
                    {iface.ipv4Addresses.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-text-muted">IPv4</span>
                        <span className="font-mono text-text-secondary">
                          {iface.ipv4Addresses.join(', ')}
                        </span>
                      </div>
                    )}
                    
                    {iface.ipv6Addresses.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-text-muted">IPv6</span>
                        <span className="font-mono text-text-secondary truncate max-w-[150px]" title={iface.ipv6Addresses.join(', ')}>
                          {iface.ipv6Addresses[0]}
                          {iface.ipv6Addresses.length > 1 && ` (+${iface.ipv6Addresses.length - 1})`}
                        </span>
                      </div>
                    )}
                    
                    {/* Traffic Stats */}
                    <div className="pt-2 mt-2 border-t border-border space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-text-muted">
                          <ArrowDown className="w-3 h-3 text-green-400" />
                          <span>RX</span>
                        </div>
                        <span className="font-mono text-text-secondary">
                          {formatBytes(iface.rxBytes)}
                          <span className="text-text-muted ml-1">
                            ({formatNumber(iface.rxPackets)} pkts)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-text-muted">
                          <ArrowUp className="w-3 h-3 text-blue-400" />
                          <span>TX</span>
                        </div>
                        <span className="font-mono text-text-secondary">
                          {formatBytes(iface.txBytes)}
                          <span className="text-text-muted ml-1">
                            ({formatNumber(iface.txPackets)} pkts)
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Info banner when no agent data */}
      {vmState === 'RUNNING' && !hasAgentData && !isLoading && (
        <div className="flex items-center gap-2 p-3 bg-bg-surface rounded-lg border border-border">
          <Info className="w-4 h-4 text-text-muted flex-shrink-0" />
          <p className="text-xs text-text-muted">
            Install the Quantix Agent in this VM to see detailed network statistics including traffic data and interface status.
          </p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !hasAgentData && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      )}
    </div>
  );
}
