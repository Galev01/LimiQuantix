/**
 * Error Boundary Component
 * 
 * Catches JavaScript errors in child component tree, logs them,
 * and displays a fallback UI instead of crashing the whole app.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

/**
 * Error Boundary wraps components and catches render errors.
 * Use around routes or critical sections of the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({ errorInfo });

    // Call optional error handler (for error tracking services)
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-[400px] flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center space-y-6">
            {/* Error Icon */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Error Message */}
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">
                Something went wrong
              </h2>
              <p className="text-gray-400 text-sm">
                An unexpected error occurred while rendering this page.
                Try refreshing or return to the dashboard.
              </p>
            </div>

            {/* Error Details (Development) */}
            {import.meta.env.DEV && this.state.error && (
              <div className="bg-red-950/30 border border-red-500/20 rounded-lg p-4 text-left">
                <p className="text-red-400 text-sm font-mono break-words">
                  {this.state.error.message}
                </p>
                {this.state.errorInfo?.componentStack && (
                  <details className="mt-2">
                    <summary className="text-red-300 text-xs cursor-pointer hover:text-red-200">
                      Component Stack
                    </summary>
                    <pre className="text-red-400/70 text-xs mt-2 overflow-auto max-h-40">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                onClick={this.handleGoHome}
                className="gap-2"
              >
                <Home className="w-4 h-4" />
                Go to Dashboard
              </Button>
              <Button
                variant="primary"
                onClick={this.handleRetry}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrapper for route-level error boundaries
 * Provides consistent styling for full-page errors
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // In production, send to error tracking service
        if (import.meta.env.PROD) {
          // Example: Sentry.captureException(error, { extra: errorInfo });
          console.error('[Production Error]', error.message);
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
