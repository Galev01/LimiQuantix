import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  RefreshCw,
  Download,
  AlertTriangle,
  Loader2,
  ChevronDown,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { cn, formatBytes } from '@/lib/utils';
import { useAppStore } from '@/stores/useAppStore';

interface VMLogsResponse {
  vmId: string;
  vmName: string;
  qemuLog: string;
  logPath: string;
  logSizeBytes: number;
  linesReturned: number;
  truncated: boolean;
  lastModified: string | null;
}

interface VMLogsPanelProps {
  vmId: string;
  vmName: string;
}

// Lines options for the dropdown
const LINES_OPTIONS = [50, 100, 200, 500, 1000];

/**
 * VMLogsPanel - Displays QEMU/libvirt logs for troubleshooting VM issues
 * 
 * Shows the last N lines from /var/log/libvirt/qemu/{vm_name}.log
 * Useful for diagnosing:
 * - Boot failures
 * - Disk I/O errors (like "No space left on device")
 * - CPU/memory issues
 * - Network configuration problems
 */
export function VMLogsPanel({ vmId, vmName }: VMLogsPanelProps) {
  const { hostUrl } = useAppStore();
  const [lines, setLines] = useState(100);
  const [copied, setCopied] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Fetch logs from the node daemon
  const {
    data: logs,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<VMLogsResponse>({
    queryKey: ['vm-logs', vmId, lines, hostUrl],
    queryFn: async () => {
      const url = `${hostUrl}/api/v1/vms/${vmId}/logs?lines=${lines}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch logs: ${response.status} ${errorText}`);
      }
      return response.json();
    },
    enabled: !!vmId && !!hostUrl,
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 10000,
  });

  // Copy logs to clipboard
  const handleCopy = useCallback(async () => {
    if (logs?.qemuLog) {
      await navigator.clipboard.writeText(logs.qemuLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [logs?.qemuLog]);

  // Download logs as file
  const handleDownload = useCallback(() => {
    if (logs?.qemuLog) {
      const blob = new Blob([logs.qemuLog], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${vmName}-qemu.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [logs?.qemuLog, vmName]);

  // Parse log line for error highlighting
  const parseLogLine = (line: string, index: number) => {
    const isError = /error|fail|panic|crash|abort|fatal|no space|permission denied/i.test(line);
    const isWarning = /warn|timeout|retry|slow|degraded/i.test(line);
    
    return (
      <div
        key={index}
        className={cn(
          'font-mono text-xs leading-relaxed px-2 py-0.5',
          isError && 'bg-error/10 text-error border-l-2 border-error',
          isWarning && !isError && 'bg-warning/10 text-warning border-l-2 border-warning',
          !isError && !isWarning && 'text-text-secondary hover:bg-bg-hover',
        )}
      >
        <span className="text-text-muted mr-2 select-none">{String(index + 1).padStart(4, ' ')}</span>
        {line || ' '}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10">
            <Terminal className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">QEMU Logs</h3>
            <p className="text-sm text-text-muted">
              Hypervisor logs for troubleshooting VM issues
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Lines selector */}
          <div className="relative">
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="appearance-none pl-3 pr-8 py-1.5 text-sm bg-bg-base border border-border rounded-lg text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {LINES_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n} lines
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          </div>
          
          {/* Auto-refresh toggle */}
          <Button
            variant={autoRefresh ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh (5s)'}
          >
            <RefreshCw className={cn('w-4 h-4', autoRefresh && 'animate-spin')} />
          </Button>
          
          {/* Manual refresh */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh
          </Button>
          
          {/* Copy */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            disabled={!logs?.qemuLog}
          >
            {copied ? (
              <Check className="w-4 h-4 text-success" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
          
          {/* Download */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDownload}
            disabled={!logs?.qemuLog}
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Log metadata */}
      {logs && (
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>
            <FileText className="w-3 h-3 inline mr-1" />
            {logs.logPath}
          </span>
          <span>Size: {formatBytes(logs.logSizeBytes)}</span>
          <span>{logs.linesReturned} lines</span>
          {logs.truncated && (
            <Badge variant="warning" size="sm">
              Truncated
            </Badge>
          )}
          {logs.lastModified && (
            <span>
              Last modified: {new Date(logs.lastModified).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {/* Log content */}
      <div className="bg-bg-base rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent mr-2" />
            <span className="text-text-muted">Loading logs...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="w-12 h-12 text-warning mb-4" />
            <h4 className="text-lg font-medium text-text-primary mb-2">Failed to Load Logs</h4>
            <p className="text-text-muted mb-4 max-w-md">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          </div>
        ) : !logs?.qemuLog ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-12 h-12 text-text-muted mb-4" />
            <h4 className="text-lg font-medium text-text-primary mb-2">No Logs Available</h4>
            <p className="text-text-muted">
              The VM has not generated any QEMU logs yet. Logs will appear after the VM is started.
            </p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <div className="min-w-max">
              {logs.qemuLog.split('\n').map((line, index) => parseLogLine(line, index))}
            </div>
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="bg-bg-surface rounded-lg border border-border p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">Common Issues to Look For</h4>
        <div className="grid grid-cols-2 gap-4 text-xs text-text-muted">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-error mt-0.5 flex-shrink-0" />
            <span><strong className="text-error">IO error</strong> - Disk space full or storage issues</span>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-error mt-0.5 flex-shrink-0" />
            <span><strong className="text-error">terminating on signal</strong> - VM was force-stopped</span>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
            <span><strong className="text-warning">permission denied</strong> - File/device access issues</span>
          </div>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
            <span><strong className="text-warning">timeout</strong> - Network or storage latency</span>
          </div>
        </div>
      </div>
    </div>
  );
}
