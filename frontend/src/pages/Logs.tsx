import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  RefreshCw, 
  Search, 
  Filter, 
  Download, 
  Pause, 
  Play,
  ChevronDown,
  ChevronRight,
  Terminal,
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Copy,
  Check,
  X,
  Server,
  MousePointer,
  FileJson,
  FileText as FileTextIcon,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLogs, useLogStream } from '@/hooks/useLogs';
import { useActionLogger } from '@/hooks/useActionLogger';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { LogComponentBadge, getComponentStyle, getAllComponentStyles } from '@/components/ui/LogComponentBadge';
import type { LogEntry } from '@/hooks/useLogs';

type LogLevel = 'all' | 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: LogLevel[] = ['all', 'trace', 'debug', 'info', 'warn', 'error'];

const levelConfig: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  trace: {
    icon: <Terminal className="w-3.5 h-3.5" />,
    color: 'text-text-muted',
    bg: 'bg-bg-base',
  },
  debug: {
    icon: <Bug className="w-3.5 h-3.5" />,
    color: 'text-text-secondary',
    bg: 'bg-bg-surface',
  },
  info: {
    icon: <Info className="w-3.5 h-3.5" />,
    color: 'text-info',
    bg: 'bg-info/5',
  },
  warn: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'text-warning',
    bg: 'bg-warning/5',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    color: 'text-error',
    bg: 'bg-error/5',
  },
};

export function Logs() {
  const logger = useActionLogger('logs');
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [showUserActionsOnly, setShowUserActionsOnly] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  
  // Fetch logs
  const { data, isLoading, refetch, isFetching } = useLogs({
    level: levelFilter === 'all' ? undefined : levelFilter,
    source: sourceFilter === 'all' ? undefined : sourceFilter,
    search: searchQuery || undefined,
    limit: 500,
  });
  
  // Real-time log streaming
  const { logs: streamedLogs, isConnected } = useLogStream(isStreaming);
  
  // Combine fetched and streamed logs
  const allLogs = [...(data?.logs || []), ...streamedLogs];
  
  // Get unique sources
  const sources = ['all', ...new Set(allLogs.map(l => l.source).filter(Boolean) as string[])];
  
  // Filter logs
  const filteredLogs = allLogs.filter(log => {
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false;
    if (showUserActionsOnly && !log.source?.startsWith('ui-')) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesMessage = log.message.toLowerCase().includes(query);
      const matchesSource = log.source?.toLowerCase().includes(query);
      const matchesFields = log.fields ? JSON.stringify(log.fields).toLowerCase().includes(query) : false;
      if (!matchesMessage && !matchesSource && !matchesFields) return false;
    }
    return true;
  });
  
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs.length, autoScroll]);
  
  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  }, []);
  
  // Download logs as JSON
  const handleDownload = (format: 'json' | 'csv' | 'txt') => {
    logger.logClick('download-logs', { format, count: filteredLogs.length });
    
    let content: string;
    let mimeType: string;
    let extension: string;
    
    if (format === 'json') {
      content = JSON.stringify(filteredLogs, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else if (format === 'csv') {
      const headers = ['timestamp', 'level', 'source', 'message'];
      const rows = filteredLogs.map(log => [
        log.timestamp,
        log.level,
        log.source || '',
        `"${log.message.replace(/"/g, '""')}"`,
      ]);
      content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    } else {
      content = filteredLogs.map(log => 
        `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source || '-'}] ${log.message}`
      ).join('\n');
      mimeType = 'text/plain';
      extension = 'txt';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quantix-vdc-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Logs downloaded as ${extension.toUpperCase()}`);
  };

  const handleToggleStreaming = () => {
    logger.logToggle('log-streaming', !isStreaming);
    setIsStreaming(!isStreaming);
  };

  const handleLevelFilterChange = (level: LogLevel) => {
    logger.logFilterChange('log-level', level);
    setLevelFilter(level);
  };

  const handleSourceFilterChange = (source: string) => {
    logger.logFilterChange('log-source', source);
    setSourceFilter(source);
  };

  const handleUserActionsToggle = () => {
    logger.logToggle('user-actions-filter', !showUserActionsOnly);
    setShowUserActionsOnly(!showUserActionsOnly);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            <Server className="w-7 h-7 text-accent" />
            Control Plane Logs
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-text-muted">{filteredLogs.length} entries</span>
            {isStreaming && (
              <Badge variant={isConnected ? 'success' : 'warning'} size="sm">
                <span className={cn(isConnected && 'animate-pulse')}>
                  {isConnected ? 'Live' : 'Connecting...'}
                </span>
              </Badge>
            )}
            {showUserActionsOnly && (
              <Badge variant="info" size="sm">
                <MousePointer className="w-3 h-3 mr-1" />
                User Actions Only
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLegend(!showLegend)}
            title="Show component legend"
            logAction
            logComponent="logs"
            logTarget="toggle-legend"
          >
            <Layers className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleStreaming}
            title={isStreaming ? 'Pause streaming' : 'Resume streaming'}
          >
            {isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <div className="relative group">
            <Button
              variant="ghost"
              size="sm"
              title="Download logs"
            >
              <Download className="w-4 h-4" />
            </Button>
            <div className="absolute right-0 top-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <button
                onClick={() => handleDownload('json')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover w-full"
              >
                <FileJson className="w-4 h-4" />
                JSON
              </button>
              <button
                onClick={() => handleDownload('csv')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover w-full"
              >
                <FileTextIcon className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={() => handleDownload('txt')}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover w-full"
              >
                <FileTextIcon className="w-4 h-4" />
                Plain Text
              </button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logger.logClick('refresh-logs');
              refetch();
            }}
            disabled={isFetching}
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Legend Panel */}
      {showLegend && (
        <div className="mb-4 p-4 bg-bg-surface rounded-lg border border-border">
          <h3 className="text-sm font-medium text-text-primary mb-3">Component Legend</h3>
          <div className="flex flex-wrap gap-2">
            {getAllComponentStyles().slice(0, 16).map(({ key, style }) => (
              <button
                key={key}
                onClick={() => {
                  setSourceFilter(key);
                  logger.logFilterChange('log-source-from-legend', key);
                }}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors',
                  style.bgColor,
                  style.color,
                  'hover:opacity-80',
                  sourceFilter === key && 'ring-2 ring-accent'
                )}
              >
                <style.icon className="w-3 h-3" />
                {style.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="mb-4 p-4 bg-bg-surface rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value) {
                  logger.logSearch(e.target.value);
                }
              }}
              placeholder="Search logs..."
              className="w-full pl-10 pr-10 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          
          {/* Level Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-text-muted" />
            <div className="flex gap-1">
              {LOG_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => handleLevelFilterChange(level)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    levelFilter === level
                      ? level === 'error' ? 'bg-error text-white'
                      : level === 'warn' ? 'bg-warning text-white'
                      : level === 'info' ? 'bg-info text-white'
                      : 'bg-accent text-white'
                      : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {level === 'all' ? 'All' : level.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Source Filter */}
          <select
            value={sourceFilter}
            onChange={(e) => handleSourceFilterChange(e.target.value)}
            className="px-3 py-1.5 bg-bg-base border border-border rounded-md text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
          >
            {sources.map(src => (
              <option key={src} value={src}>
                {src === 'all' ? 'All Sources' : src}
              </option>
            ))}
          </select>

          {/* User Actions Toggle */}
          <button
            onClick={handleUserActionsToggle}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              showUserActionsOnly
                ? 'bg-accent text-white'
                : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
            )}
          >
            <MousePointer className="w-3.5 h-3.5" />
            User Actions
          </button>
        </div>
      </div>

      {/* Logs Container */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Logs List */}
        <div 
          ref={logsContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-bg-base rounded-lg border border-border"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" />
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <Terminal className="w-12 h-12 mb-4 opacity-50" />
              <p>No logs found</p>
              {(levelFilter !== 'all' || sourceFilter !== 'all' || searchQuery) && (
                <p className="text-sm mt-1">Try adjusting your filters</p>
              )}
            </div>
          ) : (
            <div className="font-mono text-xs">
              {filteredLogs.map((log, index) => (
                <LogRow 
                  key={`${log.timestamp}-${index}`} 
                  log={log} 
                  isSelected={selectedLog?.timestamp === log.timestamp}
                  onClick={() => setSelectedLog(selectedLog?.timestamp === log.timestamp ? null : log)}
                />
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* Log Details Panel */}
        {selectedLog && (
          <LogDetailsPanel 
            log={selectedLog} 
            onClose={() => setSelectedLog(null)} 
          />
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && filteredLogs.length > 0 && (
        <button
          onClick={() => {
            setAutoScroll(true);
            logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="fixed bottom-8 right-8 px-4 py-2 bg-accent text-white rounded-lg shadow-lg hover:bg-accent/90 transition-colors flex items-center gap-2"
        >
          <ChevronDown className="w-4 h-4" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

interface LogRowProps {
  log: LogEntry;
  isSelected: boolean;
  onClick: () => void;
}

function LogRow({ log, isSelected, onClick }: LogRowProps) {
  const config = levelConfig[log.level] || levelConfig.info;
  const timestamp = new Date(log.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const isUserAction = log.source?.startsWith('ui-');

  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-start gap-2 px-3 py-1.5 border-b border-border/50 cursor-pointer transition-colors',
        'hover:bg-bg-hover/50',
        isSelected && 'bg-accent/10 border-l-2 border-l-accent',
        config.bg,
        isUserAction && 'border-l-2 border-l-teal-400/50'
      )}
    >
      {/* Expand indicator */}
      <div className="w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
        {log.fields && Object.keys(log.fields).length > 0 ? (
          isSelected ? (
            <ChevronDown className="w-3 h-3 text-text-muted" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-muted" />
          )
        ) : null}
      </div>

      {/* Timestamp */}
      <span className="text-text-muted shrink-0 w-20">{timestamp}</span>

      {/* Level */}
      <span className={cn('shrink-0 w-12 flex items-center gap-1', config.color)}>
        {config.icon}
        <span className="uppercase text-[10px] font-bold">{log.level}</span>
      </span>

      {/* Source with Component Badge */}
      <div className="shrink-0 w-36">
        <LogComponentBadge source={log.source} showLabel size="sm" />
      </div>

      {/* Message */}
      <span className="text-text-primary flex-1 break-all">{log.message}</span>

      {/* User action indicator */}
      {isUserAction && (
        <MousePointer className="w-3 h-3 text-teal-400 shrink-0" title="User Action" />
      )}

      {/* Field count indicator */}
      {log.fields && Object.keys(log.fields).length > 0 && (
        <span className="text-text-muted text-[10px] shrink-0">
          +{Object.keys(log.fields).length}
        </span>
      )}
    </div>
  );
}

interface LogDetailsPanelProps {
  log: LogEntry;
  onClose: () => void;
}

function LogDetailsPanel({ log, onClose }: LogDetailsPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const config = levelConfig[log.level] || levelConfig.info;
  const isUserAction = log.source?.startsWith('ui-');

  return (
    <div className="w-96 bg-bg-surface rounded-lg border border-border overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-text-primary">Log Details</h3>
          {isUserAction && (
            <Badge variant="info" size="sm">
              <MousePointer className="w-3 h-3 mr-1" />
              User Action
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Basic Info */}
        <div className="space-y-2">
          <DetailRow label="Timestamp" value={new Date(log.timestamp).toLocaleString()} />
          <DetailRow 
            label="Level" 
            value={
              <span className={cn('flex items-center gap-1', config.color)}>
                {config.icon}
                {log.level.toUpperCase()}
              </span>
            } 
          />
          <DetailRow 
            label="Source" 
            value={<LogComponentBadge source={log.source} showLabel size="md" />} 
          />
          <DetailRow label="Message" value={log.message} multiline />
        </div>

        {/* Structured Fields */}
        {log.fields && Object.keys(log.fields).length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-2">Structured Fields</h4>
            <div className="bg-bg-base rounded-lg p-3 space-y-1.5">
              {Object.entries(log.fields).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2 text-xs">
                  <span className="text-accent font-medium shrink-0">{key}:</span>
                  <span className="text-text-secondary break-all font-mono">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stack Trace */}
        {log.stackTrace && (
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-2">Stack Trace</h4>
            <pre className="bg-bg-base rounded-lg p-3 text-xs text-error overflow-x-auto whitespace-pre-wrap">
              {log.stackTrace}
            </pre>
          </div>
        )}

        {/* Raw JSON */}
        <div>
          <h4 className="text-sm font-medium text-text-primary mb-2">Raw JSON</h4>
          <pre className="bg-bg-base rounded-lg p-3 text-xs text-text-secondary overflow-x-auto">
            {JSON.stringify(log, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: React.ReactNode; multiline?: boolean }) {
  return (
    <div className={cn('text-sm', multiline ? 'space-y-1' : 'flex items-start gap-2')}>
      <span className="text-text-muted shrink-0">{label}:</span>
      <span className={cn('text-text-primary', multiline && 'block')}>{value}</span>
    </div>
  );
}

export default Logs;
