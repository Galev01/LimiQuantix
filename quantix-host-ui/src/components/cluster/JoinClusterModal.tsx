/**
 * Join Cluster Modal
 */

import { useState } from 'react';
import { useJoinCluster } from '@/hooks/useCluster';
import { X, Cloud, Key, Server } from 'lucide-react';

interface JoinClusterModalProps {
  onClose: () => void;
}

export function JoinClusterModal({ onClose }: JoinClusterModalProps) {
  const joinCluster = useJoinCluster();
  
  const [controlPlaneAddress, setControlPlaneAddress] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    joinCluster.mutate(
      {
        control_plane_address: controlPlaneAddress,
        registration_token: registrationToken,
      },
      {
        onSuccess: () => {
          onClose();
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-xl shadow-floating max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-default">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-neonBlue/10 rounded-lg">
              <Cloud className="w-6 h-6 text-neonBlue" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">
                Join Quantix-vDC Cluster
              </h2>
              <p className="text-sm text-text-muted">
                Connect this node to a Quantix virtual datacenter
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Info Box */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <div className="flex gap-3">
              <Server className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-200">
                <p className="font-medium mb-1">What is a Quantix-vDC?</p>
                <p className="text-blue-300/80">
                  A Quantix virtual datacenter (vDC) is a cluster of nodes managed by a central control plane. 
                  Joining a cluster enables features like live migration, distributed storage, and centralized management.
                </p>
              </div>
            </div>
          </div>

          {/* Control Plane Address */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
              <Server className="w-4 h-4 text-neonBlue" />
              Control Plane Address
            </label>
            <input
              type="text"
              value={controlPlaneAddress}
              onChange={(e) => setControlPlaneAddress(e.target.value)}
              placeholder="https://control-plane.example.com:8443"
              className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-neonBlue"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              The URL of your Quantix-vDC control plane server
            </p>
          </div>

          {/* Registration Token */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
              <Key className="w-4 h-4 text-neonPurple" />
              Registration Token
            </label>
            <input
              type="password"
              value={registrationToken}
              onChange={(e) => setRegistrationToken(e.target.value)}
              placeholder="Enter your registration token"
              className="w-full px-3 py-2 bg-bg-base border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-neonPurple font-mono"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              Obtain this token from your control plane administrator
            </p>
          </div>

          {/* Warning */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <p className="text-sm text-yellow-200">
              <strong>Note:</strong> After joining the cluster, you'll need to restart the node daemon 
              for the changes to take effect. The node will then register with the control plane automatically.
            </p>
          </div>

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
              disabled={joinCluster.isPending}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {joinCluster.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Joining...
                </>
              ) : (
                <>
                  <Cloud className="w-4 h-4" />
                  Join Cluster
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
