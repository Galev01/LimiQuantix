/**
 * Cluster Status Card Component
 */

import { useState } from 'react';
import { Card } from '@/components/ui';
import { useClusterStatus, useLeaveCluster } from '@/hooks/useCluster';
import { Cloud, CloudOff, Server, AlertCircle } from 'lucide-react';
import { JoinClusterModal } from './JoinClusterModal';

export function ClusterStatusCard() {
  const { data: status, isLoading } = useClusterStatus();
  const leaveCluster = useLeaveCluster();
  const [showJoinModal, setShowJoinModal] = useState(false);

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-bg-hover rounded w-1/3 mb-2"></div>
          <div className="h-6 bg-bg-hover rounded w-1/2"></div>
        </div>
      </Card>
    );
  }

  const isJoined = status?.joined || false;
  const isStandalone = status?.status === 'standalone';
  const needsRestart = status?.status === 'pending_restart';

  return (
    <>
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isJoined ? 'bg-green-500/10' : 'bg-gray-500/10'}`}>
              {isJoined ? (
                <Cloud className="w-6 h-6 text-green-400" />
              ) : (
                <CloudOff className="w-6 h-6 text-gray-400" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                {isJoined ? 'Cluster Mode' : 'Standalone Mode'}
              </h3>
              <p className="text-sm text-text-muted">
                {isJoined ? 'Connected to Quantix-vDC' : 'Not connected to any cluster'}
              </p>
            </div>
          </div>
        </div>

        {/* Status Details */}
        {isJoined && status?.control_plane_address && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-4 h-4 text-text-muted" />
              <span className="text-text-muted">Control Plane:</span>
              <span className="text-text-primary font-mono text-xs">
                {status.control_plane_address}
              </span>
            </div>
            {status.node_id && (
              <div className="flex items-center gap-2 text-sm">
                <Server className="w-4 h-4 text-text-muted" />
                <span className="text-text-muted">Node ID:</span>
                <span className="text-text-primary font-mono text-xs">
                  {status.node_id}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Restart Warning */}
        {needsRestart && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200">
                Configuration updated. Restart the node daemon to apply changes.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isStandalone ? (
            <button
              onClick={() => setShowJoinModal(true)}
              className="flex-1 px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
            >
              <Cloud className="w-4 h-4" />
              Join Cluster
            </button>
          ) : (
            <button
              onClick={() => {
                if (confirm('Are you sure you want to leave the cluster? This will return the node to standalone mode.')) {
                  leaveCluster.mutate();
                }
              }}
              disabled={leaveCluster.isPending}
              className="flex-1 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              {leaveCluster.isPending ? 'Leaving...' : 'Leave Cluster'}
            </button>
          )}
        </div>
      </Card>

      {showJoinModal && (
        <JoinClusterModal onClose={() => setShowJoinModal(false)} />
      )}
    </>
  );
}
