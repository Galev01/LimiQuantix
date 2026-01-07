/**
 * Settings API - Endpoints for system configuration
 */

import { get, post } from './client';

/**
 * Node settings response
 */
export interface Settings {
  node_name: string;
  node_id: string;
  grpc_listen: string;
  http_listen: string;
  log_level: string;
  storage_default_pool: string | null;
  network_default_bridge: string | null;
  vnc_listen_address: string;
  vnc_port_range_start: number;
  vnc_port_range_end: number;
}

/**
 * Update settings request
 */
export interface UpdateSettingsRequest {
  node_name?: string;
  log_level?: string;
  storage_default_pool?: string;
  network_default_bridge?: string;
  vnc_listen_address?: string;
}

/**
 * Service info
 */
export interface ServiceInfo {
  name: string;
  status: string;
  enabled: boolean;
  description: string;
}

/**
 * Get current settings
 */
export async function getSettings(): Promise<Settings> {
  return get<Settings>('/settings');
}

/**
 * Update settings
 */
export async function updateSettings(request: UpdateSettingsRequest): Promise<void> {
  return post('/settings', request);
}

/**
 * List system services
 */
export async function listServices(): Promise<{ services: ServiceInfo[] }> {
  return get<{ services: ServiceInfo[] }>('/settings/services');
}

/**
 * Restart a service
 */
export async function restartService(name: string): Promise<void> {
  return post(`/settings/services/${name}/restart`);
}
