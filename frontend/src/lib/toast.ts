/**
 * Centralized Toast Utilities
 * 
 * Provides consistent toast notifications across the application.
 * Uses sonner for toast rendering with standardized styling and messaging.
 */

import { toast } from 'sonner';

/**
 * Extract a user-friendly error message from various error types
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Handle Connect-RPC/gRPC errors
    if ('code' in error && 'message' in error) {
      const message = error.message;
      // Strip gRPC prefixes like "[internal]" or "[unavailable]"
      const cleaned = message.replace(/^\[[^\]]+\]\s*/, '');
      return cleaned || 'An unexpected error occurred';
    }
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  
  return 'An unexpected error occurred';
}

/**
 * Map gRPC status codes to user-friendly messages
 */
export function getGrpcErrorMessage(code: string | number): string {
  const codeMap: Record<string | number, string> = {
    'CANCELLED': 'Operation was cancelled',
    'UNKNOWN': 'An unknown error occurred',
    'INVALID_ARGUMENT': 'Invalid input provided',
    'DEADLINE_EXCEEDED': 'Request timed out',
    'NOT_FOUND': 'Resource not found',
    'ALREADY_EXISTS': 'Resource already exists',
    'PERMISSION_DENIED': 'Permission denied',
    'RESOURCE_EXHAUSTED': 'Resource limit exceeded',
    'FAILED_PRECONDITION': 'Operation cannot be performed in current state',
    'ABORTED': 'Operation was aborted',
    'OUT_OF_RANGE': 'Value out of valid range',
    'UNIMPLEMENTED': 'Feature not implemented',
    'INTERNAL': 'Internal server error',
    'UNAVAILABLE': 'Service temporarily unavailable',
    'DATA_LOSS': 'Data loss or corruption detected',
    'UNAUTHENTICATED': 'Authentication required',
    // Numeric codes
    1: 'Operation was cancelled',
    2: 'An unknown error occurred',
    3: 'Invalid input provided',
    4: 'Request timed out',
    5: 'Resource not found',
    6: 'Resource already exists',
    7: 'Permission denied',
    8: 'Resource limit exceeded',
    9: 'Operation cannot be performed in current state',
    10: 'Operation was aborted',
    11: 'Value out of valid range',
    12: 'Feature not implemented',
    13: 'Internal server error',
    14: 'Service temporarily unavailable',
    15: 'Data loss or corruption detected',
    16: 'Authentication required',
  };
  
  return codeMap[code] || 'An error occurred';
}

// ============================================================================
// Toast Functions
// ============================================================================

/**
 * Show a success toast notification
 */
export function showSuccess(message: string, description?: string): void {
  toast.success(message, {
    description,
    duration: 4000,
  });
}

/**
 * Show an error toast notification
 * @param error - The error object or message
 * @param context - Optional context for the error (e.g., "Failed to start VM")
 */
export function showError(error: unknown, context?: string): void {
  const message = extractErrorMessage(error);
  const title = context || 'Error';
  
  toast.error(title, {
    description: message !== title ? message : undefined,
    duration: 6000,
  });
}

/**
 * Show a warning toast notification
 */
export function showWarning(message: string, description?: string): void {
  toast.warning(message, {
    description,
    duration: 5000,
  });
}

/**
 * Show an info toast notification
 */
export function showInfo(message: string, description?: string): void {
  toast.info(message, {
    description,
    duration: 4000,
  });
}

/**
 * Show a loading toast that can be updated
 * @returns The toast ID that can be used to update/dismiss the toast
 */
export function showLoading(message: string): string | number {
  return toast.loading(message);
}

/**
 * Dismiss a specific toast by ID
 */
export function dismissToast(toastId: string | number): void {
  toast.dismiss(toastId);
}

/**
 * Update an existing toast
 */
export function updateToast(
  toastId: string | number,
  options: {
    message?: string;
    description?: string;
    type?: 'success' | 'error' | 'warning' | 'info';
  }
): void {
  const { message, description, type } = options;
  
  if (type === 'success') {
    toast.success(message || 'Success', { id: toastId, description });
  } else if (type === 'error') {
    toast.error(message || 'Error', { id: toastId, description });
  } else if (type === 'warning') {
    toast.warning(message || 'Warning', { id: toastId, description });
  } else {
    toast.info(message || 'Info', { id: toastId, description });
  }
}

/**
 * Execute an async operation with loading/success/error toasts
 * @param promise - The promise to execute
 * @param messages - Toast messages for each state
 * @returns The result of the promise
 */
export async function withToast<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error?: string | ((error: unknown) => string);
  }
): Promise<T> {
  return toast.promise(promise, {
    loading: messages.loading,
    success: (data) => 
      typeof messages.success === 'function' 
        ? messages.success(data) 
        : messages.success,
    error: (error) => 
      messages.error
        ? typeof messages.error === 'function'
          ? messages.error(error)
          : messages.error
        : extractErrorMessage(error),
  });
}

// Re-export the raw toast for advanced use cases
export { toast };
