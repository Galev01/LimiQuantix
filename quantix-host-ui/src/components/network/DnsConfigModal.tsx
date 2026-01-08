/**
 * DNS Configuration Modal
 */

import { useState } from 'react';
import { DnsConfig } from '@/api/network';
import { useSetDnsConfig } from '@/hooks/useNetwork';
import { X, Plus, Trash2 } from 'lucide-react';

interface DnsConfigModalProps {
  config?: DnsConfig;
  onClose: () => void;
}

export function DnsConfigModal({ config, onClose }: DnsConfigModalProps) {
  const setDnsConfig = useSetDnsConfig();
  
  const [nameservers, setNameservers] = useState<string[]>(config?.nameservers || ['8.8.8.8']);
  const [searchDomains, setSearchDomains] = useState<string[]>(config?.searchDomains || []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    setDnsConfig.mutate(
      { nameservers, searchDomains },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-xl shadow-floating max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">DNS Configuration</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              DNS Servers
            </label>
            {nameservers.map((ns, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={ns}
                  onChange={(e) => {
                    const newNs = [...nameservers];
                    newNs[i] = e.target.value;
                    setNameservers(newNs);
                  }}
                  className="flex-1 px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary"
                />
                <button
                  type="button"
                  onClick={() => setNameservers(nameservers.filter((_, idx) => idx !== i))}
                  className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setNameservers([...nameservers, ''])}
              className="text-sm text-neonBlue hover:underline flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add DNS Server
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Search Domains (Optional)
            </label>
            {searchDomains.map((domain, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => {
                    const newDomains = [...searchDomains];
                    newDomains[i] = e.target.value;
                    setSearchDomains(newDomains);
                  }}
                  placeholder="example.com"
                  className="flex-1 px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary"
                />
                <button
                  type="button"
                  onClick={() => setSearchDomains(searchDomains.filter((_, idx) => idx !== i))}
                  className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSearchDomains([...searchDomains, ''])}
              className="text-sm text-neonBlue hover:underline flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              Add Search Domain
            </button>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-bg-hover text-text-primary rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={setDnsConfig.isPending}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg"
            >
              {setDnsConfig.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
