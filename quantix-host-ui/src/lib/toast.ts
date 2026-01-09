/**
 * Simple toast notification system without framer-motion
 * Uses CSS animations to avoid React 19 compatibility issues
 */

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';

interface ToastOptions {
  duration?: number;
}

let toastContainer: HTMLDivElement | null = null;

function ensureContainer() {
  if (toastContainer) return toastContainer;
  
  toastContainer = document.createElement('div');
  toastContainer.id = 'toast-container';
  toastContainer.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

function createToast(message: string, type: ToastType, options: ToastOptions = {}) {
  const container = ensureContainer();
  const duration = options.duration ?? (type === 'loading' ? 0 : 4000);
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-family: system-ui, -apple-system, sans-serif;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 400px;
    animation: slideIn 0.2s ease-out;
    transition: opacity 0.2s, transform 0.2s;
  `;
  
  // Type-specific styles
  const styles: Record<ToastType, { bg: string; color: string; icon: string }> = {
    success: { bg: '#10b981', color: '#ffffff', icon: '✓' },
    error: { bg: '#ef4444', color: '#ffffff', icon: '✕' },
    info: { bg: '#3b82f6', color: '#ffffff', icon: 'ℹ' },
    warning: { bg: '#f59e0b', color: '#ffffff', icon: '⚠' },
    loading: { bg: '#6b7280', color: '#ffffff', icon: '◌' },
  };
  
  const style = styles[type];
  toast.style.backgroundColor = style.bg;
  toast.style.color = style.color;
  
  // Icon
  const icon = document.createElement('span');
  icon.textContent = style.icon;
  icon.style.cssText = type === 'loading' ? 'animation: spin 1s linear infinite;' : '';
  toast.appendChild(icon);
  
  // Message
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  
  // Add animation keyframes if not already added
  if (!document.getElementById('toast-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'toast-styles';
    styleSheet.textContent = `
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styleSheet);
  }
  
  container.appendChild(toast);
  
  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
  
  // Return dismiss function for loading toasts
  return () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 200);
  };
}

/**
 * Toast notification helpers
 */
export const toast = {
  success: (message: string, options?: ToastOptions) => createToast(message, 'success', options),
  error: (message: string, options?: ToastOptions) => createToast(message, 'error', options),
  info: (message: string, options?: ToastOptions) => createToast(message, 'info', options),
  warning: (message: string, options?: ToastOptions) => createToast(message, 'warning', options),
  loading: (message: string, options?: ToastOptions) => createToast(message, 'loading', options),
  promise: async <T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string;
      error: string | ((error: unknown) => string);
    }
  ): Promise<T> => {
    const dismiss = createToast(messages.loading, 'loading');
    try {
      const result = await promise;
      dismiss();
      createToast(messages.success, 'success');
      return result;
    } catch (error) {
      dismiss();
      const errorMessage = typeof messages.error === 'function' 
        ? messages.error(error) 
        : messages.error;
      createToast(errorMessage, 'error');
      throw error;
    }
  },
};
