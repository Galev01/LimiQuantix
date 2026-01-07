/**
 * Create Bridge Modal
 */

import { useState } from 'react';
import { NetworkInterface } from '@/api/network';
import { useCreateBridge } from '@/hooks/useNetwork';
import { X } from 'lucide-react';

interface CreateBridgeModalProps {
  interfaces: NetworkInterface[];
  onClose: () => void;
}

export function CreateBridgeModal({ interfaces, onClose }: CreateBridgeModalProps) {
  const createBridge = useCreateBridge();
  
  const [name, setName] = useState('br0');
  const [selectedInterfaces, setSelectedInterfaces] = useState<string[]>([]);

  const toggleInterface = (ifaceName: string) => {
    setSelectedInterfaces(prev =>
      prev.includes(ifaceName)
        ? prev.filter(n => n !== ifaceName)
        : [...prev, ifaceName]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createBridge.mutate(
      { name, interfaces: selectedInterfaces },
      { onSuccess: () => onClose() }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-xl shadow-floating max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">Create Bridge</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Bridge Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="br0"
              className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Physical Interfaces
            </label>
            <div className="space-y-2">
              {interfaces.filter(i => i.type === 'ethernet').map(iface => (
                <label key={iface.name} className="flex items-center gap-2 p-2 hover:bg-bg-hover rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedInterfaces.includes(iface.name)}
                    onChange={() => toggleInterface(iface.name)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-text-primary">{iface.name}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-bg-hover text-text-primary rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createBridge.isPending || selectedInterfaces.length === 0}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg disabled:opacity-50"
            >
              {createBridge.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
