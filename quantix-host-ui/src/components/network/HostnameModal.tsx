/**
 * Hostname Configuration Modal
 */

import { useState } from 'react';
import { useSetHostname } from '@/hooks/useNetwork';
import { X } from 'lucide-react';

interface HostnameModalProps {
  hostname: string;
  onClose: () => void;
}

export function HostnameModal({ hostname: initialHostname, onClose }: HostnameModalProps) {
  const setHostname = useSetHostname();
  const [hostname, setHostnameValue] = useState(initialHostname);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHostname.mutate({ hostname }, { onSuccess: () => onClose() });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-xl shadow-floating max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-border-default">
          <h2 className="text-xl font-semibold text-text-primary">Set Hostname</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Hostname
            </label>
            <input
              type="text"
              value={hostname}
              onChange={(e) => setHostnameValue(e.target.value)}
              placeholder="quantix-node-01"
              className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              Use lowercase letters, numbers, and hyphens only
            </p>
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
              disabled={setHostname.isPending}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg"
            >
              {setHostname.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
