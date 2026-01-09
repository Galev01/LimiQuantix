import { Link } from 'react-router-dom';
import { Boxes, ArrowLeft, Construction } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useApiConnection } from '@/hooks/useDashboard';

/**
 * ClusterDetail page - placeholder until cluster API is implemented
 * 
 * This page will display detailed information about a specific cluster
 * including hosts, VMs, resource usage, HA/DRS settings, and events.
 */
export function ClusterDetail() {
  // API connection
  const { data: isConnected = false } = useApiConnection();

  // TODO: Replace with real API hook when cluster service is implemented
  // const { data: cluster, isLoading } = useCluster(id);

  return (
    <div className="flex flex-col items-center justify-center h-96">
      <div className="relative mb-6">
        <Boxes className="w-16 h-16 text-text-muted" />
        <Construction className="w-8 h-8 text-warning absolute -bottom-1 -right-1" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Cluster Management Coming Soon
      </h2>
      <p className="text-text-muted text-center max-w-md mb-6">
        {!isConnected 
          ? 'Connect to the backend to view cluster details.'
          : 'Cluster management features including HA, DRS, and resource pools will be available in a future update.'}
      </p>
      <Link to="/clusters">
        <Button>
          <ArrowLeft className="w-4 h-4" />
          Back to Clusters
        </Button>
      </Link>
    </div>
  );
}
