/**
 * React Hook for UI Action Logging
 * 
 * Provides a convenient way to log UI actions within React components
 * with automatic component context.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  type UIComponent,
  type UIAction,
  type UILogLevel,
  logUIAction,
  logClick,
  logFormSubmit,
  logNavigation,
  logModalOpen,
  logModalClose,
  logTabSwitch,
  logFilterChange,
  logSearch,
  logSelect,
  logToggle,
  logError,
  logSuccess,
  logWarning,
  generateCorrelationId,
} from '@/lib/uiLogger';

/**
 * Action logger interface returned by the hook
 */
export interface ActionLogger {
  /** Log a button click */
  logClick: (target: string, metadata?: Record<string, unknown>) => void;
  /** Log a form submission */
  logSubmit: (formName: string, data?: Record<string, unknown>) => void;
  /** Log navigation between pages/views */
  logNavigation: (from: string, to: string) => void;
  /** Log opening a modal/dialog */
  logModalOpen: (modalName: string, metadata?: Record<string, unknown>) => void;
  /** Log closing a modal/dialog */
  logModalClose: (modalName: string, metadata?: Record<string, unknown>) => void;
  /** Log switching tabs */
  logTabSwitch: (tabName: string, metadata?: Record<string, unknown>) => void;
  /** Log filter changes */
  logFilterChange: (filterName: string, value: unknown) => void;
  /** Log search queries */
  logSearch: (query: string) => void;
  /** Log selection changes */
  logSelect: (target: string, value: unknown) => void;
  /** Log toggle actions */
  logToggle: (target: string, enabled: boolean) => void;
  /** Log errors */
  logError: (action: string, error: Error | string, metadata?: Record<string, unknown>) => void;
  /** Log success messages */
  logSuccess: (action: string, message: string, metadata?: Record<string, unknown>) => void;
  /** Log warnings */
  logWarning: (action: string, message: string, metadata?: Record<string, unknown>) => void;
  /** Log a custom action */
  log: (level: UILogLevel, action: UIAction, target: string, message: string, metadata?: Record<string, unknown>) => void;
  /** Generate a correlation ID for tracking related actions */
  generateCorrelationId: () => string;
  /** Current correlation ID (if set) */
  correlationId: string | undefined;
  /** Set correlation ID for subsequent logs */
  setCorrelationId: (id: string | undefined) => void;
}

/**
 * Hook for logging UI actions with component context
 * 
 * @param component - The UI component category for all logs from this hook
 * @returns ActionLogger interface with logging methods
 * 
 * @example
 * ```tsx
 * function VMList() {
 *   const logger = useActionLogger('vm');
 *   
 *   const handleStart = (vmId: string) => {
 *     logger.logClick('start-vm', { vmId });
 *     // ... start VM logic
 *   };
 *   
 *   return <button onClick={() => handleStart('vm-123')}>Start</button>;
 * }
 * ```
 */
export function useActionLogger(component: UIComponent): ActionLogger {
  const correlationIdRef = useRef<string | undefined>(undefined);

  const setCorrelationId = useCallback((id: string | undefined) => {
    correlationIdRef.current = id;
  }, []);

  const logger = useMemo<ActionLogger>(() => ({
    logClick: (target, metadata) => {
      logClick(component, target, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logSubmit: (formName, data) => {
      logFormSubmit(component, formName, { ...data, correlationId: correlationIdRef.current });
    },
    
    logNavigation: (from, to) => {
      logNavigation(component, from, to);
    },
    
    logModalOpen: (modalName, metadata) => {
      logModalOpen(component, modalName, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logModalClose: (modalName, metadata) => {
      logModalClose(component, modalName, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logTabSwitch: (tabName, metadata) => {
      logTabSwitch(component, tabName, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logFilterChange: (filterName, value) => {
      logFilterChange(component, filterName, value);
    },
    
    logSearch: (query) => {
      logSearch(component, query);
    },
    
    logSelect: (target, value) => {
      logSelect(component, target, value);
    },
    
    logToggle: (target, enabled) => {
      logToggle(component, target, enabled);
    },
    
    logError: (action, error, metadata) => {
      logError(component, action, error, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logSuccess: (action, message, metadata) => {
      logSuccess(component, action, message, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    logWarning: (action, message, metadata) => {
      logWarning(component, action, message, { ...metadata, correlationId: correlationIdRef.current });
    },
    
    log: (level, action, target, message, metadata) => {
      logUIAction(level, action, component, target, message, { ...metadata }, correlationIdRef.current);
    },
    
    generateCorrelationId: () => {
      const id = generateCorrelationId();
      correlationIdRef.current = id;
      return id;
    },
    
    get correlationId() {
      return correlationIdRef.current;
    },
    
    setCorrelationId,
  }), [component, setCorrelationId]);

  return logger;
}

/**
 * Hook for creating a scoped logger with a specific correlation ID
 * Useful for tracking multi-step operations
 * 
 * @param component - The UI component category
 * @returns ActionLogger with auto-generated correlation ID
 * 
 * @example
 * ```tsx
 * function CreateVMWizard() {
 *   const logger = useScopedActionLogger('vm');
 *   
 *   // All logs from this component will share the same correlation ID
 *   const handleNext = () => {
 *     logger.logClick('wizard-next', { step: currentStep });
 *   };
 * }
 * ```
 */
export function useScopedActionLogger(component: UIComponent): ActionLogger {
  const logger = useActionLogger(component);
  
  // Generate correlation ID on mount
  useMemo(() => {
    logger.generateCorrelationId();
  }, [logger]);
  
  return logger;
}

export default useActionLogger;
