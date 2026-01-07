/**
 * Interface Configuration Modal
 */

import { useState } from 'react';
import { NetworkInterface, ConfigureInterfaceRequest } from '@/api/network';
import { useConfigureInterface } from '@/hooks/useNetwork';
import { X } from 'lucide-react';

interface InterfaceConfigModalProps {
  interface: NetworkInterface;
  onClose: () => void;
}

export function InterfaceConfigModal({ interface: iface, onClose }: InterfaceConfigModalProps) {
  const configureInterface = useConfigureInterface();
  
  const [useDhcp, setUseDhcp] = useState(iface.ip_addresses.length === 0);
  const [ipAddress, setIpAddress] = useState(iface.ip_addresses[0] || '');
  const [netmask, setNetmask] = useState('255.255.255.0');
  const [gateway, setGateway] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const config: ConfigureInterfaceRequest = {
      dhcp: useDhcp,
      ip_address: useDhcp ? undefined : ipAddress,
      netmask: useDhcp ? undefined : netmask,
      gateway: useDhcp || !gateway ? undefined : gateway,
    };

    configureInterface.mutate(
      { name: iface.name, config },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-xl shadow-floating max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">
            Configure {iface.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* DHCP Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-primary">
              Use DHCP
            </label>
            <button
              type="button"
              onClick={() => setUseDhcp(!useDhcp)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                useDhcp ? 'bg-neonBlue' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  useDhcp ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Static IP Configuration */}
          {!useDhcp && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  IP Address
                </label>
                <input
                  type="text"
                  value={ipAddress}
                  onChange={(e) => setIpAddress(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-neonBlue"
                  required={!useDhcp}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Netmask
                </label>
                <input
                  type="text"
                  value={netmask}
                  onChange={(e) => setNetmask(e.target.value)}
                  placeholder="255.255.255.0"
                  className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-neonBlue"
                  required={!useDhcp}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Gateway (Optional)
                </label>
                <input
                  type="text"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  placeholder="192.168.1.1"
                  className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-neonBlue"
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-bg-hover text-text-primary rounded-lg hover:bg-bg-base transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={configureInterface.isPending}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {configureInterface.isPending ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
