/**
 * VM Creation Wizard Validation Utilities
 * 
 * Provides comprehensive validation for each step of the VM creation wizard.
 * Includes field-level validation, step validation, and pre-flight checks.
 */

import type { CloudImage } from '@/hooks/useImages';
import type { StoragePoolUI } from '@/hooks/useStorage';

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface StepValidation {
  valid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

export interface PreflightCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// FIELD VALIDATORS
// =============================================================================

/**
 * Validate VM name
 * - Required
 * - 3-63 characters
 * - Alphanumeric + dashes
 * - No leading/trailing dashes
 * - Cannot start with a number
 */
export function validateVMName(name: string): ValidationResult {
  const trimmed = name.trim();
  
  if (!trimmed) {
    return { valid: false, error: 'VM name is required' };
  }
  
  if (trimmed.length < 3) {
    return { valid: false, error: 'VM name must be at least 3 characters' };
  }
  
  if (trimmed.length > 63) {
    return { valid: false, error: 'VM name cannot exceed 63 characters' };
  }
  
  // Check for valid characters (alphanumeric + dashes)
  if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
    return { valid: false, error: 'VM name can only contain letters, numbers, and dashes' };
  }
  
  // No leading/trailing dashes
  if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
    return { valid: false, error: 'VM name cannot start or end with a dash' };
  }
  
  // Cannot start with a number
  if (/^[0-9]/.test(trimmed)) {
    return { valid: false, error: 'VM name cannot start with a number' };
  }
  
  return { valid: true };
}

/**
 * Validate hostname
 * - Optional, but if provided must be valid
 * - 1-63 characters
 * - Alphanumeric + dashes
 * - No leading/trailing dashes
 */
export function validateHostname(hostname: string): ValidationResult {
  if (!hostname) {
    return { valid: true }; // Optional field
  }
  
  const trimmed = hostname.trim();
  
  if (trimmed.length > 63) {
    return { valid: false, error: 'Hostname cannot exceed 63 characters' };
  }
  
  if (!/^[a-zA-Z0-9-]+$/.test(trimmed)) {
    return { valid: false, error: 'Hostname can only contain letters, numbers, and dashes' };
  }
  
  if (trimmed.startsWith('-') || trimmed.endsWith('-')) {
    return { valid: false, error: 'Hostname cannot start or end with a dash' };
  }
  
  return { valid: true };
}

/**
 * Validate password and confirmation match
 */
export function validatePassword(password: string, confirmPassword: string): ValidationResult {
  if (!password) {
    return { valid: true }; // Optional if SSH keys are provided
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (password !== confirmPassword) {
    return { valid: false, error: 'Passwords do not match' };
  }
  
  return { valid: true };
}

/**
 * Validate SSH key format
 */
export function validateSSHKey(key: string): ValidationResult {
  const trimmed = key.trim();
  
  if (!trimmed) {
    return { valid: false, error: 'SSH key is required' };
  }
  
  const validPrefixes = ['ssh-rsa', 'ssh-ed25519', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];
  const startsWithValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));
  
  if (!startsWithValidPrefix) {
    return { valid: false, error: 'Invalid SSH key format. Key should start with ssh-rsa, ssh-ed25519, etc.' };
  }
  
  const parts = trimmed.split(' ');
  if (parts.length < 2) {
    return { valid: false, error: 'Invalid SSH key format. Key appears incomplete.' };
  }
  
  const keyData = parts[1];
  if (keyData.length < 100) {
    return { valid: false, error: 'SSH key data appears too short. Make sure you copied the entire key.' };
  }
  
  return { valid: true };
}

/**
 * Validate CPU cores
 */
export function validateCPUCores(cores: number): ValidationResult {
  if (cores < 1) {
    return { valid: false, error: 'CPU cores must be at least 1' };
  }
  
  if (cores > 128) {
    return { valid: false, error: 'CPU cores cannot exceed 128' };
  }
  
  return { valid: true };
}

/**
 * Validate memory
 */
export function validateMemory(memoryMib: number): ValidationResult {
  if (memoryMib < 512) {
    return { valid: false, error: 'Memory must be at least 512 MiB' };
  }
  
  if (memoryMib > 1048576) { // 1 TiB
    return { valid: false, error: 'Memory cannot exceed 1 TiB' };
  }
  
  return { valid: true };
}

/**
 * Validate disk size
 */
export function validateDiskSize(sizeGib: number, availableGib?: number): ValidationResult {
  if (sizeGib < 1) {
    return { valid: false, error: 'Disk size must be at least 1 GiB' };
  }
  
  if (sizeGib > 16384) { // 16 TiB
    return { valid: false, error: 'Disk size cannot exceed 16 TiB' };
  }
  
  if (availableGib !== undefined && sizeGib > availableGib) {
    return { 
      valid: false, 
      error: `Disk size (${sizeGib} GiB) exceeds available pool capacity (${availableGib.toFixed(1)} GiB)` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate description length
 */
export function validateDescription(description: string): ValidationResult {
  if (description.length > 500) {
    return { valid: false, error: 'Description cannot exceed 500 characters' };
  }
  
  return { valid: true };
}

// =============================================================================
// IMAGE AVAILABILITY
// =============================================================================

export type ImageAvailabilityStatus = 
  | 'available'      // Image is downloaded on the target node
  | 'downloading'    // Image is currently being downloaded
  | 'not_downloaded' // Image needs to be downloaded
  | 'error'          // Download failed
  | 'checking';      // Checking availability

export interface ImageAvailability {
  status: ImageAvailabilityStatus;
  progress?: number;
  errorMessage?: string;
  sizeBytes?: number;
}

/**
 * Check if a cloud image requires access credentials (password or SSH key)
 */
export function requiresAccessMethod(cloudImage?: CloudImage): boolean {
  if (!cloudImage) return false;
  return cloudImage.os.cloudInitEnabled;
}

/**
 * Validate that user has set up access method for cloud images
 */
export function validateAccessMethod(
  hasPassword: boolean,
  hasSSHKeys: boolean,
  cloudImage?: CloudImage
): ValidationResult {
  if (!cloudImage || !cloudImage.os.cloudInitEnabled) {
    return { valid: true };
  }
  
  if (!hasPassword && !hasSSHKeys) {
    return { 
      valid: false, 
      error: 'You must set a password or add at least one SSH key to access this VM' 
    };
  }
  
  return { valid: true };
}

// =============================================================================
// STORAGE VALIDATION
// =============================================================================

/**
 * Check if storage pool is accessible from selected node
 */
export function isPoolAccessibleFromNode(pool: StoragePoolUI, nodeId: string): boolean {
  if (!pool.assignedNodeIds || pool.assignedNodeIds.length === 0) {
    return true; // Pool is accessible from all nodes (shared storage)
  }
  
  return pool.assignedNodeIds.includes(nodeId);
}

/**
 * Validate storage pool selection
 */
export function validateStoragePool(
  pool: StoragePoolUI | undefined,
  nodeId: string | undefined,
  totalDiskSizeGib: number
): ValidationResult {
  if (!pool) {
    return { valid: false, error: 'Storage pool is required' };
  }
  
  if (pool.status.phase === 'ERROR') {
    return { valid: false, error: `Storage pool "${pool.name}" is in error state` };
  }
  
  if (pool.status.phase === 'DELETING') {
    return { valid: false, error: `Storage pool "${pool.name}" is being deleted` };
  }
  
  if (nodeId && !isPoolAccessibleFromNode(pool, nodeId)) {
    return { 
      valid: false, 
      error: `Storage pool "${pool.name}" is not available on the selected host` 
    };
  }
  
  const availableGib = pool.capacity.availableBytes / (1024 * 1024 * 1024);
  if (totalDiskSizeGib > availableGib) {
    return { 
      valid: false, 
      error: `Total disk size (${totalDiskSizeGib} GiB) exceeds available pool capacity (${availableGib.toFixed(1)} GiB)` 
    };
  }
  
  return { valid: true };
}

// =============================================================================
// NODE VALIDATION
// =============================================================================

export interface NodeResourceCheck {
  valid: boolean;
  cpuAvailable: number;
  cpuRequired: number;
  memoryAvailableMib: number;
  memoryRequiredMib: number;
  error?: string;
}

/**
 * Check if node has sufficient resources
 */
export function checkNodeResources(
  node: { cpuCapacity: number; cpuAllocated: number; memoryCapacityMib: number; memoryAllocatedMib: number } | undefined,
  cpuRequired: number,
  memoryRequiredMib: number
): NodeResourceCheck {
  if (!node) {
    return {
      valid: false,
      cpuAvailable: 0,
      cpuRequired,
      memoryAvailableMib: 0,
      memoryRequiredMib,
      error: 'No node selected'
    };
  }
  
  const cpuAvailable = node.cpuCapacity - node.cpuAllocated;
  const memoryAvailableMib = node.memoryCapacityMib - node.memoryAllocatedMib;
  
  if (cpuRequired > cpuAvailable) {
    return {
      valid: false,
      cpuAvailable,
      cpuRequired,
      memoryAvailableMib,
      memoryRequiredMib,
      error: `Insufficient CPU: ${cpuRequired} vCPUs needed, ${cpuAvailable} available`
    };
  }
  
  if (memoryRequiredMib > memoryAvailableMib) {
    return {
      valid: false,
      cpuAvailable,
      cpuRequired,
      memoryAvailableMib,
      memoryRequiredMib,
      error: `Insufficient memory: ${memoryRequiredMib} MiB needed, ${memoryAvailableMib} MiB available`
    };
  }
  
  return {
    valid: true,
    cpuAvailable,
    cpuRequired,
    memoryAvailableMib,
    memoryRequiredMib
  };
}

// =============================================================================
// PREFLIGHT CHECKS
// =============================================================================

export interface PreflightContext {
  nodeOnline: boolean;
  nodeId?: string;
  poolAccessible: boolean;
  poolId?: string;
  imageAvailable: boolean;
  imageId?: string;
  hasAccessMethod: boolean;
}

/**
 * Run comprehensive pre-flight checks before VM creation
 */
export function runPreflightChecks(ctx: PreflightContext): PreflightCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check node availability
  if (ctx.nodeId && !ctx.nodeOnline) {
    errors.push('Selected host is offline. Choose a different host or use auto-placement.');
  }
  
  // Check storage pool
  if (ctx.poolId && !ctx.poolAccessible) {
    errors.push('Selected storage pool is not accessible from the target host.');
  }
  
  // Check image availability
  if (ctx.imageId && !ctx.imageAvailable) {
    errors.push('Selected image is not downloaded on the target host. Download it first or select another image.');
  }
  
  // Check access method
  if (ctx.imageId && !ctx.hasAccessMethod) {
    warnings.push('No password or SSH key configured. You may not be able to log into the VM.');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
