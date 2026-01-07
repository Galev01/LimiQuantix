import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSettings, updateSettings, listServices, restartService } from '@/api/settings';
import type { UpdateSettingsRequest } from '@/api/settings';
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings updated');
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
