/**
 * Cluster API client
 * 
 * The Host UI does NOT join clusters directly.
 * Instead, it:
 * 1. Tests connectivity to the vDC control plane
 * 2. Generates a registration token that the vDC can use to add this host
 */

import { get, post } from './client';

export interface ClusterStatus {
  joined: boolean;
  control_plane_address?: string;
  node_id?: string;
  last_heartbeat?: string;
  status: 'connected' | 'disconnected' | 'standalone' | 'pending_restart';
  mode: 'standalone' | 'cluster';
  clusterName?: string;
  controllerUrl?: string;
}

export interface ClusterConfig {
  enabled: boolean;
  control_plane_address: string;
  node_id?: string;
  registration_token?: string;
  heartbeat_interval_secs: number;
}

export interface TestConnectionRequest {
  controlPlaneUrl: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  clusterName?: string;
  clusterVersion?: string;
}

export interface GenerateTokenResponse {
  token: string;
  nodeId: string;
  hostName: string;
  managementIp: string;
  expiresAt: string;
}

// Cluster operations
export async function getClusterStatus(): Promise<ClusterStatus> {
  return get<ClusterStatus>('/cluster/status');
}

/**
 * Test connectivity to a vDC control plane
 */
export async function testConnection(request: TestConnectionRequest): Promise<TestConnectionResponse> {
  return post<TestConnectionResponse>('/cluster/test-connection', request);
}

/**
 * Generate a registration token that vDC can use to add this host
 * This does NOT join the cluster - the vDC will initiate the actual join
 */
export async function generateRegistrationToken(): Promise<GenerateTokenResponse> {
  return post<GenerateTokenResponse>('/cluster/generate-token');
}

/**
 * Leave the cluster and return to standalone mode
 */
export async function leaveCluster(): Promise<ClusterStatus> {
  return post<ClusterStatus>('/cluster/leave');
}

export async function getClusterConfig(): Promise<ClusterConfig> {
  return get<ClusterConfig>('/cluster/config');
}
