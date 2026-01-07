/**
 * Cluster API client
 */

import { get, post } from './client';

export interface ClusterStatus {
  joined: boolean;
  control_plane_address?: string;
  node_id?: string;
  last_heartbeat?: string;
  status: 'connected' | 'disconnected' | 'standalone' | 'pending_restart';
}

export interface ClusterConfig {
  enabled: boolean;
  control_plane_address: string;
  node_id?: string;
  registration_token?: string;
  heartbeat_interval_secs: number;
}

export interface JoinClusterRequest {
  control_plane_address: string;
  registration_token: string;
}

// Cluster operations
export async function getClusterStatus(): Promise<ClusterStatus> {
  return get<ClusterStatus>('/cluster/status');
}

export async function joinCluster(request: JoinClusterRequest): Promise<ClusterStatus> {
  return post<ClusterStatus>('/cluster/join', request);
}

export async function leaveCluster(): Promise<ClusterStatus> {
  return post<ClusterStatus>('/cluster/leave');
}

export async function getClusterConfig(): Promise<ClusterConfig> {
  return get<ClusterConfig>('/cluster/config');
}
