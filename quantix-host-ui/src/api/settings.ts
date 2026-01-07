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

// ============================================================================
// Certificate Management
// ============================================================================

/**
 * TLS certificate information
 */
export interface CertificateInfo {
  mode: 'self-signed' | 'manual' | 'acme';
  issuer: string;
  subject: string;
  validFrom: string;
  validUntil: string;
  daysUntilExpiry: number;
  serialNumber: string;
  fingerprint: string;
}

/**
 * ACME account information
 */
export interface AcmeInfo {
  registered: boolean;
  email?: string;
  directory?: string;
  lastRenewal?: string;
  nextRenewal?: string;
}

/**
 * Get current certificate info
 */
export async function getCertificateInfo(): Promise<CertificateInfo> {
  return get<CertificateInfo>('/settings/certificates');
}

/**
 * Upload a custom certificate
 */
export async function uploadCertificate(cert: string, key: string): Promise<void> {
  return post('/settings/certificates/upload', { cert, key });
}

/**
 * Generate a new self-signed certificate
 */
export async function generateSelfSigned(hostname?: string): Promise<void> {
  return post('/settings/certificates/generate', { hostname });
}

/**
 * Reset certificate to default self-signed
 */
export async function resetCertificate(): Promise<void> {
  return post('/settings/certificates', { action: 'reset' });
}

/**
 * Get ACME account info
 */
export async function getAcmeInfo(): Promise<AcmeInfo> {
  return get<AcmeInfo>('/settings/certificates/acme');
}

/**
 * Register ACME account
 */
export async function registerAcmeAccount(email: string, directory?: string): Promise<void> {
  return post('/settings/certificates/acme/register', { email, directory });
}

/**
 * Issue certificate via ACME
 */
export async function issueAcmeCertificate(domains: string[]): Promise<void> {
  return post('/settings/certificates/acme/issue', { domains });
}