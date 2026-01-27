import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Terminal,
  Play,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ExecuteScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
}

interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  error: string;
}

export function ExecuteScriptModal({
  isOpen,
  onClose,
  vmId,
  vmName,
}: ExecuteScriptModalProps) {
  const [command, setCommand] = useState('');
  const [executionTimeout, setExecutionTimeout] = useState(60);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [copied, setCopied] = useState<'stdout' | 'stderr' | null>(null);

  const handleExecute = async () => {
    if (!command.trim()) return;

    setIsExecuting(true);
    setResult(null);

    try {
      const response = await fetch(`/api/vms/${vmId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: command.trim(),
          timeoutSeconds: executionTimeout,
          waitForExit: true,
        }),
      });

      const data = await response.json();
      setResult({
        success: data.success,
        exitCode: data.exitCode ?? -1,
        stdout: data.stdout ?? '',
        stderr: data.stderr ?? '',
        timedOut: data.timedOut ?? false,
        durationMs: data.durationMs ?? 0,
        error: data.error ?? '',
      });
    } catch (err) {
      setResult({
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '',
        timedOut: false,
        durationMs: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopy = async (text: string, type: 'stdout' | 'stderr') => {
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && !isExecuting) {
      handleExecute();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-bg-surface rounded-xl shadow-2xl border border-border m-4 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Terminal className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Execute Script
                </h2>
                <p className="text-sm text-text-muted">
                  Run commands on {vmName} via Quantix Agent
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Command Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-primary">
                Command
              </label>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter command to execute (e.g., ls -la, cat /etc/os-release)"
                className="w-full h-24 px-4 py-3 bg-bg-base rounded-lg border border-border
                  text-text-primary placeholder-text-muted font-mono text-sm
                  focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent
                  resize-none"
                disabled={isExecuting}
              />
              <p className="text-xs text-text-muted">
                Press <kbd className="px-1 py-0.5 bg-bg-elevated rounded text-xs">Ctrl+Enter</kbd> to execute
              </p>
            </div>

            {/* Timeout Setting */}
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-text-primary">
                Timeout:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={executionTimeout}
                  onChange={(e) => setExecutionTimeout(Math.max(1, parseInt(e.target.value) || 60))}
                  className="w-20 px-3 py-2 bg-bg-base rounded-lg border border-border
                    text-text-primary text-sm text-center
                    focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  min={1}
                  max={3600}
                  disabled={isExecuting}
                />
                <span className="text-sm text-text-muted">seconds</span>
              </div>
            </div>

            {/* Timeout Warning */}
            {executionTimeout > 30 && (
              <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-warning">Timeout Warning</p>
                  <p className="text-text-muted mt-1">
                    Scripts longer than 30 seconds may timeout. The HTTP request will fail,
                    but the script may continue running in the guest. For long-running operations
                    (like package updates or database backups), check the VM console to monitor progress.
                  </p>
                </div>
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="space-y-4">
                {/* Status Bar */}
                <div
                  className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                    result.success
                      ? 'bg-success/10 border-success/30 text-success'
                      : 'bg-error/10 border-error/30 text-error'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span className="font-medium">
                      {result.timedOut
                        ? 'Command timed out'
                        : result.error
                        ? 'Execution failed'
                        : result.success
                        ? 'Command succeeded'
                        : `Command failed (exit code ${result.exitCode})`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm opacity-75">
                    <Clock className="w-4 h-4" />
                    {result.durationMs}ms
                  </div>
                </div>

                {/* Error */}
                {result.error && (
                  <div className="p-4 bg-error/10 rounded-lg border border-error/30">
                    <p className="text-sm text-error">{result.error}</p>
                  </div>
                )}

                {/* stdout */}
                {result.stdout && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-primary">
                        Standard Output
                      </label>
                      <button
                        onClick={() => handleCopy(result.stdout, 'stdout')}
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                      >
                        {copied === 'stdout' ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-4 bg-bg-base rounded-lg border border-border text-sm font-mono text-text-secondary overflow-x-auto max-h-48 overflow-y-auto">
                      {result.stdout}
                    </pre>
                  </div>
                )}

                {/* stderr */}
                {result.stderr && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-warning">
                        Standard Error
                      </label>
                      <button
                        onClick={() => handleCopy(result.stderr, 'stderr')}
                        className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                      >
                        {copied === 'stderr' ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-4 bg-warning/5 rounded-lg border border-warning/30 text-sm font-mono text-warning overflow-x-auto max-h-48 overflow-y-auto">
                      {result.stderr}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-elevated/30">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={handleExecute}
              disabled={!command.trim() || isExecuting}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Executing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
