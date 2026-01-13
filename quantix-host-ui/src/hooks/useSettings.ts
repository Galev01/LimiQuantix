import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  getSettings, 
  updateSettings, 
  listServices, 
  restartService,
  getCertificateInfo,
  uploadCertificate,
  generateSelfSigned,
  resetCertificate,
  getAcmeInfo,
  registerAcmeAccount,
  issueAcmeCertificate,
  getSshStatus,
  enableSsh,
  disableSsh,
} from '@/api/settings';
import type { UpdateSettingsRequest, EnableSshRequest } from '@/api/settings';
import { toast } from '@/lib/toast';

/**
 * Hook to fetch current settings
 */
export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Hook to update settings
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateSettingsRequest) => updateSettings(request),
    onSuccess: (_, request) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      // If node name (hostname) was updated, also refresh host info since it displays the hostname
      if (request.node_name) {
        queryClient.invalidateQueries({ queryKey: ['host'] });
      }
      toast.success('Settings updated. Hostname changed.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });
}

/**
 * Hook to fetch system services
 */
export function useServices() {
  return useQuery({
    queryKey: ['settings', 'services'],
    queryFn: listServices,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Hook to restart a service
 */
export function useRestartService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => restartService(name),
    onSuccess: (_, name) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'services'] });
      toast.success(`Service ${name} restarted`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to restart service: ${error.message}`);
    },
  });
}

// ============================================================================
// Certificate Management Hooks
// ============================================================================

/**
 * Hook to fetch certificate info
 */
export function useCertificateInfo() {
  return useQuery({
    queryKey: ['settings', 'certificates'],
    queryFn: getCertificateInfo,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Hook to upload a certificate
 */
export function useUploadCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ cert, key }: { cert: string; key: string }) => uploadCertificate(cert, key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates'] });
      toast.success('Certificate uploaded. Restart may be required.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to upload certificate: ${error.message}`);
    },
  });
}

/**
 * Hook to generate self-signed certificate
 */
export function useGenerateSelfSigned() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostname?: string) => generateSelfSigned(hostname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates'] });
      toast.success('Self-signed certificate generated');
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate certificate: ${error.message}`);
    },
  });
}

/**
 * Hook to reset certificate to default
 */
export function useResetCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetCertificate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates'] });
      toast.success('Certificate reset to default');
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset certificate: ${error.message}`);
    },
  });
}

/**
 * Hook to fetch ACME account info
 */
export function useAcmeInfo() {
  return useQuery({
    queryKey: ['settings', 'certificates', 'acme'],
    queryFn: getAcmeInfo,
    staleTime: 60_000,
  });
}

/**
 * Hook to register ACME account
 */
export function useRegisterAcme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, directory }: { email: string; directory?: string }) =>
      registerAcmeAccount(email, directory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates', 'acme'] });
      toast.success('ACME account registered');
    },
    onError: (error: Error) => {
      toast.error(`Failed to register ACME account: ${error.message}`);
    },
  });
}

/**
 * Hook to issue ACME certificate
 */
export function useIssueAcmeCertificate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (domains: string[]) => issueAcmeCertificate(domains),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'certificates', 'acme'] });
      toast.success('Certificate issued successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to issue certificate: ${error.message}`);
    },
  });
}

// ============================================================================
// SSH Management Hooks
// ============================================================================

/**
 * Hook to fetch SSH status
 */
export function useSshStatus() {
  return useQuery({
    queryKey: ['settings', 'ssh'],
    queryFn: getSshStatus,
    staleTime: 10_000, // 10 seconds - refresh frequently since SSH can expire
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
  });
}

/**
 * Hook to enable SSH with time limit
 */
export function useEnableSsh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: EnableSshRequest) => enableSsh(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'ssh'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'services'] });
      toast.success(`SSH enabled for ${data.remainingMinutes ?? 'unknown'} minutes`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to enable SSH: ${error.message}`);
    },
  });
}

/**
 * Hook to disable SSH
 */
export function useDisableSsh() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disableSsh,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'ssh'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'services'] });
      toast.success('SSH disabled');
    },
    onError: (error: Error) => {
      toast.error(`Failed to disable SSH: ${error.message}`);
    },
  });
}
