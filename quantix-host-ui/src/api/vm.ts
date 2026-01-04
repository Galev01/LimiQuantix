/**
 * VM API - Virtual Machine operations
 */

import { get, post, del } from './client';
import type { 
  VirtualMachine, 
  CreateVmRequest, 
  ConsoleInfo, 
  Snapshot 
} from './types';

/**
 * List all VMs on this host
 */
export async function listVMs(): Promise<VirtualMachine[]> {
  const response = await get<{ vms: VirtualMachine[] }>('/vms');
  return response.vms || [];
}

/**
 * Get a single VM by ID
 */
export async function getVM(vmId: string): Promise<VirtualMachine> {
  return get<VirtualMachine>(`/vms/${vmId}`);
}

/**
 * Create a new VM
 */
export async function createVM(request: CreateVmRequest): Promise<{ vmId: string }> {
  return post<{ vmId: string }>('/vms', request);
}

/**
 * Delete a VM
 */
export async function deleteVM(vmId: string): Promise<void> {
  return del(`/vms/${vmId}`);
}

// ============================================================================
// Power Operations
// ============================================================================

/**
 * Start a VM
 */
export async function startVM(vmId: string): Promise<void> {
  return post(`/vms/${vmId}/start`);
}

/**
 * Stop a VM (graceful shutdown)
 */
export async function stopVM(vmId: string, timeoutSeconds = 30): Promise<void> {
  return post(`/vms/${vmId}/stop`, { timeoutSeconds });
}

/**
 * Force stop a VM (hard power off)
 */
export async function forceStopVM(vmId: string): Promise<void> {
  return post(`/vms/${vmId}/force-stop`);
}

/**
 * Reboot a VM
 */
export async function rebootVM(vmId: string): Promise<void> {
  return post(`/vms/${vmId}/reboot`);
}

/**
 * Pause a VM
 */
export async function pauseVM(vmId: string): Promise<void> {
  return post(`/vms/${vmId}/pause`);
}

/**
 * Resume a paused VM
 */
export async function resumeVM(vmId: string): Promise<void> {
  return post(`/vms/${vmId}/resume`);
}

// ============================================================================
// Console Access
// ============================================================================

/**
 * Get console connection information
 */
export async function getConsole(vmId: string): Promise<ConsoleInfo> {
  return get<ConsoleInfo>(`/vms/${vmId}/console`);
}

// ============================================================================
// Snapshots
// ============================================================================

/**
 * List snapshots for a VM
 */
export async function listSnapshots(vmId: string): Promise<Snapshot[]> {
  const response = await get<{ snapshots: Snapshot[] }>(`/vms/${vmId}/snapshots`);
  return response.snapshots || [];
}

/**
 * Create a snapshot
 */
export async function createSnapshot(
  vmId: string, 
  name: string, 
  description?: string
): Promise<Snapshot> {
  return post<Snapshot>(`/vms/${vmId}/snapshots`, { name, description });
}

/**
 * Revert to a snapshot
 */
export async function revertSnapshot(vmId: string, snapshotId: string): Promise<void> {
  return post(`/vms/${vmId}/snapshots/${snapshotId}/revert`);
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(vmId: string, snapshotId: string): Promise<void> {
  return del(`/vms/${vmId}/snapshots/${snapshotId}`);
}
