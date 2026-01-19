import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, MonitorPlay, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface StartAndOpenConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  onStartVM: () => Promise<void>;
  onOpenConsole: () => void;
  isStarting?: boolean;
  vmState?: string;
}

type StartState = 'idle' | 'starting' | 'waiting' | 'ready' | 'error';

export function StartAndOpenConsoleModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  onStartVM,
  onOpenConsole,
  isStarting = false,
  vmState = 'STOPPED',
}: StartAndOpenConsoleModalProps) {
  const [startState, setStartState] = useState<StartState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  
  const maxPollAttempts = 30; // 30 * 2 seconds = 60 seconds max wait
  const pollInterval = 2000;

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStartState('idle');
      setError(null);
      setPollCount(0);
    }
  }, [isOpen]);

  // Watch for VM state changes
  useEffect(() => {
    if (startState === 'waiting' && vmState === 'RUNNING') {
      setStartState('ready');
      // Auto-open console after a short delay
      setTimeout(() => {
        onOpenConsole();
        onClose();
      }, 500);
    }
  }, [vmState, startState, onOpenConsole, onClose]);

  // Poll counter for timeout
  useEffect(() => {
    if (startState === 'waiting') {
      const timer = setInterval(() => {
        setPollCount(prev => {
          if (prev >= maxPollAttempts) {
            setStartState('error');
            setError('VM did not start within expected time. Please check the VM status.');
            return prev;
          }
          return prev + 1;
        });
      }, pollInterval);
      
      return () => clearInterval(timer);
    }
  }, [startState]);

  const handleStartAndOpenConsole = useCallback(async () => {
    setStartState('starting');
    setError(null);
    
    try {
      await onStartVM();
      setStartState('waiting');
    } catch (err) {
      setStartState('error');
      setError(err instanceof Error ? err.message : 'Failed to start VM');
    }
  }, [onStartVM]);

  const handleClose = () => {
    if (startState === 'starting' || startState === 'waiting') {
      // Don't close while operation is in progress
      return;
    }
    onClose();
  };

  if (!isOpen) return null;

  const getStatusText = () => {
    switch (startState) {
      case 'starting':
        return 'Starting VM...';
      case 'waiting':
        return `Waiting for VM to be ready... (${pollCount}s)`;
      case 'ready':
        return 'VM is running! Opening console...';
      case 'error':
        return 'Error';
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md mx-4 bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/20">
                <MonitorPlay className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Open Console</h2>
                <p className="text-sm text-text-muted">{vmName}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={startState === 'starting' || startState === 'waiting'}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {startState === 'idle' && (
              <div className="text-center">
                <div className="p-4 rounded-full bg-bg-base inline-block mb-4">
                  <MonitorPlay className="w-10 h-10 text-text-muted" />
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  VM is not running
                </h3>
                <p className="text-sm text-text-muted mb-6">
                  Console access requires the VM to be running. Would you like to start the VM and open the console?
                </p>
              </div>
            )}

            {(startState === 'starting' || startState === 'waiting') && (
              <div className="text-center py-4">
                <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  {startState === 'starting' ? 'Starting VM...' : 'Waiting for VM to be ready...'}
                </h3>
                <p className="text-sm text-text-muted">
                  {startState === 'waiting' && (
                    <>The console will open automatically once the VM is running.</>
                  )}
                </p>
                {startState === 'waiting' && (
                  <div className="mt-4">
                    <div className="w-full bg-bg-base rounded-full h-2">
                      <div 
                        className="bg-accent h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((pollCount / maxPollAttempts) * 100, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-text-muted mt-2">
                      {pollCount * 2}s elapsed
                    </p>
                  </div>
                )}
              </div>
            )}

            {startState === 'ready' && (
              <div className="text-center py-4">
                <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  VM is running!
                </h3>
                <p className="text-sm text-text-muted">
                  Opening console...
                </p>
              </div>
            )}

            {startState === 'error' && (
              <div className="text-center py-4">
                <div className="p-4 rounded-full bg-error/20 inline-block mb-4">
                  <X className="w-10 h-10 text-error" />
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  Failed to start VM
                </h3>
                <p className="text-sm text-error mb-4">
                  {error}
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-elevated/30">
            {startState === 'idle' && (
              <>
                <Button
                  variant="secondary"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStartAndOpenConsole}
                  disabled={isStarting}
                >
                  <Play className="w-4 h-4" />
                  Start & Open Console
                </Button>
              </>
            )}
            
            {startState === 'error' && (
              <>
                <Button
                  variant="secondary"
                  onClick={onClose}
                >
                  Close
                </Button>
                <Button
                  variant="primary"
                  onClick={handleStartAndOpenConsole}
                >
                  <Play className="w-4 h-4" />
                  Try Again
                </Button>
              </>
            )}
            
            {(startState === 'starting' || startState === 'waiting') && (
              <p className="text-sm text-text-muted">
                Please wait...
              </p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
