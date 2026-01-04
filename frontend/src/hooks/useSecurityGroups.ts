/**
 * React Query hooks for Security Group operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { securityGroupApi, type ApiSecurityGroup, type SecurityGroupListResponse } from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

export const securityGroupKeys = {
  all: ['securityGroups'] as const,
  lists: () => [...securityGroupKeys.all, 'list'] as const,
  list: (projectId?: string) => [...securityGroupKeys.lists(), { projectId }] as const,
  details: () => [...securityGroupKeys.all, 'detail'] as const,
  detail: (id: string) => [...securityGroupKeys.details(), id] as const,
};

export function useSecurityGroups(options?: { projectId?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: securityGroupKeys.list(options?.projectId),
    queryFn: () => securityGroupApi.list({ projectId: options?.projectId }),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    retry: 2,
  });
}

export function useSecurityGroup(id: string, enabled = true) {
  return useQuery({
    queryKey: securityGroupKeys.detail(id),
    queryFn: () => securityGroupApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

export function useCreateSecurityGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; projectId: string; description?: string }) =>
      securityGroupApi.create(data),
    onSuccess: (sg) => {
      showSuccess(`Security group "${sg.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: securityGroupKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create security group');
    },
  });
}

export function useAddSecurityGroupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      securityGroupId,
      rule,
    }: {
      securityGroupId: string;
      rule: {
        direction: 'INGRESS' | 'EGRESS';
        protocol: string;
        portRangeMin?: number;
        portRangeMax?: number;
        remoteIpPrefix?: string;
      };
    }) => securityGroupApi.addRule(securityGroupId, rule),
    onSuccess: (sg) => {
      showSuccess('Rule added successfully');
      queryClient.setQueryData(securityGroupKeys.detail(sg.id), sg);
      queryClient.invalidateQueries({ queryKey: securityGroupKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to add rule');
    },
  });
}

export function useRemoveSecurityGroupRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ securityGroupId, ruleId }: { securityGroupId: string; ruleId: string }) =>
      securityGroupApi.removeRule(securityGroupId, ruleId),
    onSuccess: (sg) => {
      showSuccess('Rule removed successfully');
      queryClient.setQueryData(securityGroupKeys.detail(sg.id), sg);
      queryClient.invalidateQueries({ queryKey: securityGroupKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to remove rule');
    },
  });
}

export function useDeleteSecurityGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => securityGroupApi.delete(id),
    onSuccess: (_, id) => {
      showSuccess('Security group deleted successfully');
      queryClient.removeQueries({ queryKey: securityGroupKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: securityGroupKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete security group');
    },
  });
}

export type { ApiSecurityGroup, SecurityGroupListResponse };
