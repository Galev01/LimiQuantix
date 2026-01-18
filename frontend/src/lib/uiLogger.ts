/**
 * UI Action Logger for Quantix-vDC Dashboard
 * 
 * Provides centralized logging for all UI actions (button clicks, form submissions,
 * navigation, errors) with component categorization and correlation IDs.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * UI Component categories for log categorization
 */
export type UIComponent =
  | 'vm'
  | 'storage'
  | 'network'
  | 'cluster'
  | 'admin'
  | 'settings'
  | 'dashboard'
  | 'console'
  | 'auth'
  | 'alerts'
  | 'monitoring'
  | 'logs'
  | 'updates'
  | 'folders'
  | 'images';

/**
 * UI Action types
 */
export type UIAction =
  | 'button.click'
  | 'form.submit'
  | 'form.change'
  | 'modal.open'
  | 'modal.close'
  | 'navigation'
  | 'tab.switch'
  | 'filter.change'
  | 'search'
  | 'select'
  | 'toggle'
  | 'drag.drop'
  | 'context.menu'
  | 'error'
  | 'success'
  | 'warning';

/**
 * Log level for UI logs
 */
export type UILogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * UI Log entry structure
 */
export interface UILogEntry {
  timestamp: string;
  level: UILogLevel;
  action: UIAction;
  component: UIComponent;
  target: string;
  message: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  userAction: true;
}

/**
 * Component configuration for visual styling
 */
export interface ComponentConfig {
  icon: string;
  color: string;
  label: string;
  category: string;
}

// ============================================================================
// Component Configuration
// ============================================================================

export const COMPONENT_CONFIG: Record<UIComponent, ComponentConfig> = {
  vm: { icon: 'Monitor', color: '#10b981', label: 'Virtual Machines', category: 'compute' },
  storage: { icon: 'HardDrive', color: '#f59e0b', label: 'Storage', category: 'storage' },
  network: { icon: 'Network', color: '#8b5cf6', label: 'Network', category: 'network' },
  cluster: { icon: 'Server', color: '#3b82f6', label: 'Cluster', category: 'infrastructure' },
  admin: { icon: 'Settings', color: '#6b7280', label: 'Admin', category: 'admin' },
  settings: { icon: 'Cog', color: '#64748b', label: 'Settings', category: 'admin' },
  dashboard: { icon: 'LayoutDashboard', color: '#0ea5e9', label: 'Dashboard', category: 'overview' },
  console: { icon: 'Terminal', color: '#22c55e', label: 'Console', category: 'compute' },
  auth: { icon: 'Shield', color: '#ef4444', label: 'Authentication', category: 'security' },
  alerts: { icon: 'Bell', color: '#f97316', label: 'Alerts', category: 'monitoring' },
  monitoring: { icon: 'Activity', color: '#06b6d4', label: 'Monitoring', category: 'monitoring' },
  logs: { icon: 'FileText', color: '#84cc16', label: 'Logs', category: 'monitoring' },
  updates: { icon: 'Download', color: '#a855f7', label: 'Updates', category: 'system' },
  folders: { icon: 'Folder', color: '#eab308', label: 'Folders', category: 'organization' },
  images: { icon: 'Disc', color: '#ec4899', label: 'Images', category: 'storage' },
};

// ============================================================================
// Session Management
// ============================================================================

let sessionId: string | null = null;
let userId: string | null = null;
let correlationCounter = 0;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate a correlation ID for tracking related actions
 */
export function generateCorrelationId(): string {
  correlationCounter++;
  return `corr-${Date.now()}-${correlationCounter}`;
}

/**
 * Get or create session ID
 */
export function getSessionId(): string {
  if (!sessionId) {
    // Try to get from sessionStorage first
    sessionId = sessionStorage.getItem('quantix-session-id');
    if (!sessionId) {
      sessionId = generateSessionId();
      sessionStorage.setItem('quantix-session-id', sessionId);
    }
  }
  return sessionId;
}

/**
 * Set the current user ID for logging
 */
export function setUserId(id: string | null): void {
  userId = id;
}

/**
 * Get the current user ID
 */
export function getUserId(): string | null {
  return userId;
}

// ============================================================================
// Log Buffer & Submission
// ============================================================================

const LOG_BUFFER: UILogEntry[] = [];
const MAX_BUFFER_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Add a log entry to the buffer
 */
function addToBuffer(entry: UILogEntry): void {
  LOG_BUFFER.push(entry);
  
  // Keep buffer size manageable
  if (LOG_BUFFER.length > MAX_BUFFER_SIZE) {
    LOG_BUFFER.shift();
  }
  
  // Schedule flush if not already scheduled
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush logs to the backend
 */
async function flushLogs(): Promise<void> {
  if (LOG_BUFFER.length === 0) {
    flushTimer = null;
    return;
  }
  
  const logsToSend = [...LOG_BUFFER];
  LOG_BUFFER.length = 0;
  flushTimer = null;
  
  try {
    const response = await fetch('/api/logs/ui', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ logs: logsToSend }),
    });
    
    if (!response.ok) {
      // Put logs back in buffer on failure
      LOG_BUFFER.unshift(...logsToSend);
      console.warn('[UILogger] Failed to submit logs:', response.status);
    }
  } catch (error) {
    // Put logs back in buffer on error
    LOG_BUFFER.unshift(...logsToSend);
    console.warn('[UILogger] Error submitting logs:', error);
  }
}

/**
 * Force flush all pending logs
 */
export function forceFlush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return flushLogs();
}

// ============================================================================
// Core Logging Functions
// ============================================================================

/**
 * Create a UI log entry
 */
function createLogEntry(
  level: UILogLevel,
  action: UIAction,
  component: UIComponent,
  target: string,
  message: string,
  metadata?: Record<string, unknown>,
  correlationId?: string
): UILogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    action,
    component,
    target,
    message,
    metadata,
    correlationId,
    userId: getUserId() ?? undefined,
    sessionId: getSessionId(),
    userAction: true,
  };
}

/**
 * Log a UI action
 */
export function logUIAction(
  level: UILogLevel,
  action: UIAction,
  component: UIComponent,
  target: string,
  message: string,
  metadata?: Record<string, unknown>,
  correlationId?: string
): void {
  const entry = createLogEntry(level, action, component, target, message, metadata, correlationId);
  
  // Always log to console in development
  if (import.meta.env.DEV) {
    const config = COMPONENT_CONFIG[component];
    const style = `color: ${config.color}; font-weight: bold;`;
    console.log(
      `%c[${config.label}]%c ${action}: ${message}`,
      style,
      'color: inherit',
      metadata || ''
    );
  }
  
  // Add to buffer for backend submission
  addToBuffer(entry);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Log a button click
 */
export function logClick(
  component: UIComponent,
  target: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('info', 'button.click', component, target, `Clicked ${target}`, metadata);
}

/**
 * Log a form submission
 */
export function logFormSubmit(
  component: UIComponent,
  formName: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('info', 'form.submit', component, formName, `Submitted ${formName}`, metadata);
}

/**
 * Log a navigation event
 */
export function logNavigation(
  component: UIComponent,
  from: string,
  to: string
): void {
  logUIAction('info', 'navigation', component, to, `Navigated from ${from} to ${to}`, { from, to });
}

/**
 * Log a modal open
 */
export function logModalOpen(
  component: UIComponent,
  modalName: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('info', 'modal.open', component, modalName, `Opened ${modalName}`, metadata);
}

/**
 * Log a modal close
 */
export function logModalClose(
  component: UIComponent,
  modalName: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('debug', 'modal.close', component, modalName, `Closed ${modalName}`, metadata);
}

/**
 * Log a tab switch
 */
export function logTabSwitch(
  component: UIComponent,
  tabName: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('debug', 'tab.switch', component, tabName, `Switched to tab ${tabName}`, metadata);
}

/**
 * Log a filter change
 */
export function logFilterChange(
  component: UIComponent,
  filterName: string,
  value: unknown
): void {
  logUIAction('debug', 'filter.change', component, filterName, `Changed filter ${filterName}`, { value });
}

/**
 * Log a search action
 */
export function logSearch(
  component: UIComponent,
  query: string
): void {
  logUIAction('debug', 'search', component, 'search', `Searched for "${query}"`, { query });
}

/**
 * Log a selection
 */
export function logSelect(
  component: UIComponent,
  target: string,
  selectedValue: unknown
): void {
  logUIAction('debug', 'select', component, target, `Selected ${target}`, { value: selectedValue });
}

/**
 * Log a toggle action
 */
export function logToggle(
  component: UIComponent,
  target: string,
  enabled: boolean
): void {
  logUIAction('info', 'toggle', component, target, `Toggled ${target} ${enabled ? 'on' : 'off'}`, { enabled });
}

/**
 * Log an error
 */
export function logError(
  component: UIComponent,
  action: string,
  error: Error | string,
  metadata?: Record<string, unknown>
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;
  logUIAction('error', 'error', component, action, `Error in ${action}: ${errorMessage}`, {
    ...metadata,
    error: errorMessage,
    stack: errorStack,
  });
}

/**
 * Log a success action
 */
export function logSuccess(
  component: UIComponent,
  action: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('info', 'success', component, action, message, metadata);
}

/**
 * Log a warning
 */
export function logWarning(
  component: UIComponent,
  action: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  logUIAction('warn', 'warning', component, action, message, metadata);
}

// ============================================================================
// Export Default Logger Object
// ============================================================================

export const uiLogger = {
  click: logClick,
  submit: logFormSubmit,
  navigate: logNavigation,
  modalOpen: logModalOpen,
  modalClose: logModalClose,
  tabSwitch: logTabSwitch,
  filterChange: logFilterChange,
  search: logSearch,
  select: logSelect,
  toggle: logToggle,
  error: logError,
  success: logSuccess,
  warning: logWarning,
  log: logUIAction,
  flush: forceFlush,
  setUserId,
  getSessionId,
  generateCorrelationId,
  COMPONENT_CONFIG,
};

export default uiLogger;
