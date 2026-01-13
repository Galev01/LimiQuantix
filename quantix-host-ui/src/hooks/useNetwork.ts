/**
 * React hooks for network operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import * as networkApi from '@/api/network';

// Query keys
const NETWORK_KEYS = {
  all: ['network'] as const,
  interfaces: () => [...NETWORK_KEYS.all, 'interfaces'] as const,
  interface: (name: string) => [...NETWORK_KEYS.interfaces(), name] as const,
  dns: () => [...NETWORK_KEYS.all, 'dns'] as const,
  hostname: () => [...NETWORK_KEYS.all, 'hostname'] as const,
};

// List all network interfaces
export function useNetworkInterfaces() {
  return useQuery({
    queryKey: NETWORK_KEYS.interfaces(),
    queryFn: networkApi.listNetworkInterfaces,
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}

// Get a specific network interface
export function useNetworkInterface(name: string) {
  return useQuery({
    queryKey: NETWORK_KEYS.interface(name),
    queryFn: () => networkApi.getNetworkInterface(name),
    enabled: !!name,
  });
}

// Configure network interface
export function useConfigureInterface() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, config }: { name: string; config: networkApi.ConfigureInterfaceRequest }) =>
      networkApi.configureNetworkInterface(name, config),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: NETWORK_KEYS.interfaces() });
      queryClient.invalidateQueries({ queryKey: NETWORK_KEYS.interface(variables.name) });
      toast.success(`Interface ${variables.name} configured successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to configure interface: ${error.message}`);
    },
  });
}

// Create bridge
export function useCreateBridge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: networkApi.createBridge,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: NETWORK_KEYS.interfaces() });
      toast.success(`Bridge ${data.name} created successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create bridge: ${error.message}`);
    },
  });
}

// DNS configuration
export function useDnsConfig() {
  return useQuery({
    queryKey: NETWORK_KEYS.dns(),
    queryFn: networkApi.getDnsConfig,
  });
}

export function useSetDnsConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: networkApi.setDnsConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NETWORK_KEYS.dns() });
      toast.success('DNS configuration updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update DNS configuration: ${error.message}`);
    },
  });
}

// Hostname
export function useHostname() {
  return useQuery({
    queryKey: NETWORK_KEYS.hostname(),
    queryFn: networkApi.getHostname,
  });
}

export function useSetHostname() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: networkApi.setHostname,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NETWORK_KEYS.hostname() });
      toast.success('Hostname updated successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update hostname: ${error.message}`);
    },
  });
}

/**
 * Hook to list available virtual networks for VM creation
 * Returns libvirt networks available on the host
 */
export function useNetworks() {
  return useQuery({
    queryKey: ['networks', 'virtual'],
    queryFn: async () => {
      // Fetch virtual networks from the node daemon
      const response = await fetch('/api/v1/networks');
      if (!response.ok) {
        throw new Error(`Failed to fetch networks: ${response.statusText}`);
      }
      return response.json();
    },
    staleTime: 30000,
  });
}