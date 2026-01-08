/**
 * Network API client
 */

import { get, post } from './client';

export interface NetworkInterface {
  name: string;
  macAddress: string;
  type: 'ethernet' | 'bridge' | 'bond' | 'vlan';
  state: 'up' | 'down';
  ipAddresses: string[];
  mtu: number;
  speedMbps?: number;
}

export interface NetworkInterfaceList {
  interfaces: NetworkInterface[];
}

export interface ConfigureInterfaceRequest {
  dhcp: boolean;
  ipAddress?: string;
  netmask?: string;
  gateway?: string;
}

export interface CreateBridgeRequest {
  name: string;
  interfaces: string[];
}

export interface DnsConfig {
  nameservers: string[];
  searchDomains: string[];
}

export interface HostnameConfig {
  hostname: string;
}

// Network interface operations
export async function listNetworkInterfaces(): Promise<NetworkInterfaceList> {
  return get<NetworkInterfaceList>('/network/interfaces');
}

export async function getNetworkInterface(name: string): Promise<NetworkInterface> {
  return get<NetworkInterface>(`/network/interfaces/${name}`);
}

export async function configureNetworkInterface(
  name: string,
  config: ConfigureInterfaceRequest
): Promise<NetworkInterface> {
  return post<NetworkInterface>(`/network/interfaces/${name}/configure`, config);
}

export async function createBridge(request: CreateBridgeRequest): Promise<NetworkInterface> {
  return post<NetworkInterface>('/network/bridges', request);
}

// DNS operations
export async function getDnsConfig(): Promise<DnsConfig> {
  return get<DnsConfig>('/network/dns');
}

export async function setDnsConfig(config: DnsConfig): Promise<DnsConfig> {
  return post<DnsConfig>('/network/dns', config);
}

// Hostname operations
export async function getHostname(): Promise<HostnameConfig> {
  return get<HostnameConfig>('/network/hostname');
}

export async function setHostname(config: HostnameConfig): Promise<HostnameConfig> {
  return post<HostnameConfig>('/network/hostname', config);
}
