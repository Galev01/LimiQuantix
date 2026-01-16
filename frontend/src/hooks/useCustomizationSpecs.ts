/**
 * Customization Specification hooks
 * 
 * Document ID: 000063
 * 
 * Provides hooks for fetching and managing reusable guest OS customization
 * specifications, similar to VMware's Customization Specs.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApiBase } from '@/lib/api-client';

// API Configuration - use centralized API base URL
const getApiBaseUrl = () => getApiBase();

// Types
export interface LinuxCustomization {
  hostnameTemplate: string;
  domain: string;
  timezone: string;
  sshAuthorizedKeys: string[];
  runCommands: string[];
  packages: string[];
}

export interface WindowsCustomization {
  computerNameTemplate: string;
  productKey: string;
  timezone: string;
  adminPassword: string;
  autoLogon: boolean;
  workgroup: string;
  runOnce: string[];
}

export interface CustomizationSpec {
  id: string;
  name: string;
  description: string;
  projectId: string;
  type: 'LINUX' | 'WINDOWS';
  linuxSpec?: LinuxCustomization;
  windowsSpec?: WindowsCustomization;
  installAgent: boolean;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface CreateCustomizationSpecRequest {
  name: string;
  description?: string;
  projectId?: string;
  type: 'LINUX' | 'WINDOWS';
  linuxSpec?: Partial<LinuxCustomization>;
  windowsSpec?: Partial<WindowsCustomization>;
  installAgent?: boolean;
  labels?: Record<string, string>;
}

// Fallback specs when API is unavailable
const FALLBACK_SPECS: CustomizationSpec[] = [
  {
    id: '20000000-0000-0000-0000-000000000001',
    name: 'Default Linux',
    description: 'Default Linux customization with Quantix agent installation',
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'LINUX',
    linuxSpec: {
      timezone: 'UTC',
      hostnameTemplate: 'vm-{name}',
      domain: '',
      sshAuthorizedKeys: [],
      runCommands: [],
      packages: [],
    },
    installAgent: true,
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
  {
    id: '20000000-0000-0000-0000-000000000002',
    name: 'Default Windows',
    description: 'Default Windows customization with Quantix agent installation',
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'WINDOWS',
    windowsSpec: {
      timezone: 'UTC',
      computerNameTemplate: 'VM-{NAME}',
      productKey: '',
      adminPassword: '',
      autoLogon: false,
      workgroup: 'WORKGROUP',
      runOnce: [],
    },
    installAgent: true,
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
  {
    id: '20000000-0000-0000-0000-000000000003',
    name: 'Ubuntu Server Hardened',
    description: 'Hardened Ubuntu Server with security packages',
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'LINUX',
    linuxSpec: {
      timezone: 'UTC',
      hostnameTemplate: 'srv-{name}',
      domain: '',
      sshAuthorizedKeys: [],
      runCommands: [
        'apt-get update',
        'apt-get install -y ufw fail2ban',
        'ufw enable',
      ],
      packages: ['ufw', 'fail2ban', 'unattended-upgrades'],
    },
    installAgent: true,
    labels: { security: 'hardened' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
];

/**
 * Fetch customization specs from the API
 */
async function fetchCustomizationSpecs(projectId?: string, type?: string): Promise<CustomizationSpec[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/customization-specs`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch customization specs: ${response.statusText}`);
  }

  const data = await response.json();
  return data.specs || [];
}

/**
 * Create a new customization spec
 */
async function createCustomizationSpec(request: CreateCustomizationSpecRequest): Promise<CustomizationSpec> {
  const response = await fetch(`${getApiBaseUrl()}/api/customization-specs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Failed to create customization spec');
  }

  return await response.json();
}

/**
 * Hook to fetch customization specs
 */
export function useCustomizationSpecs(options?: { projectId?: string; type?: 'LINUX' | 'WINDOWS' }) {
  const { projectId, type } = options || {};

  return useQuery({
    queryKey: ['customization-specs', projectId, type],
    queryFn: async () => {
      try {
        const specs = await fetchCustomizationSpecs(projectId, type);
        return { specs, isUsingFallback: false };
      } catch (error) {
        console.warn('Failed to fetch customization specs from API, using fallback:', error);
        // Filter fallback by type if specified
        const filtered = type 
          ? FALLBACK_SPECS.filter(s => s.type === type)
          : FALLBACK_SPECS;
        return { specs: filtered, isUsingFallback: true };
      }
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to create a customization spec
 */
export function useCreateCustomizationSpec() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createCustomizationSpec,
    onSuccess: (spec) => {
      queryClient.invalidateQueries({ queryKey: ['customization-specs'] });
      toast.success(`Customization spec "${spec.name}" created successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create customization spec: ${error.message}`);
    },
  });
}

/**
 * Get a spec by ID
 */
export function getSpecById(specs: CustomizationSpec[], id: string): CustomizationSpec | undefined {
  return specs.find(s => s.id === id);
}

/**
 * Format spec for display in a dropdown
 */
export function formatSpecOption(spec: CustomizationSpec): string {
  return `${spec.name} (${spec.type})`;
}
