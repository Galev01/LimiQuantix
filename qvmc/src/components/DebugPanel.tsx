import { useEffect, useState, useRef } from 'react';
import {
  X,
  Copy,
  Download,
  Trash2,
  Bug,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
} from 'lucide-react';
import { debugLogger, LogEntry } from '../lib/debug-logger';

interface DebugPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type LogFilter = 'all' | 'info' | 'warn' | 'error' | 'debug';

export function DebugPanel({ isOpen, onClose }: DebugPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to log updates
  useEffect(() => {
    const unsubscribe = debugLogger.subscribe((newEntries) => {
      setEntries(newEntries);
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // Filter entries
  const filteredEntries = entries.filter((entry) => {
    // Level filter
    if (filter !== 'all' && entry.level !== filter) {
      return false;
    }
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        entry.message.toLowerCase().includes(query) ||
        entry.source.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Copy to clipboard
  const handleCopy = async () => {
    await debugLogger.copyToClipboard();
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  // Download as file
  const handleDownload = () => {
    const text = debugLogger.exportAsText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QvMC-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clear logs
  const handleClear = () => {
    debugLogger.clear();
  };

  // Get level color
  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-orange-400';
      case 'info':
        return 'text-blue-400';
      case 'debug':
        return 'text-gray-400';
      default:
        return 'text-gray-400';
    }
  };

  // Get level background
  const getLevelBg = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return 'bg-red-500/10';
      case 'warn':
        return 'bg-orange-500/10';
      case 'info':
        return 'bg-blue-500/10';
      case 'debug':
        return 'bg-gray-500/10';
      default:
        return 'bg-gray-500/10';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="debug-panel-overlay" onClick={onClose}>
      <div className="debug-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="debug-panel-header">
          <div className="flex items-center gap-3">
            <div className="debug-panel-icon">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Debug Logs</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {filteredEntries.length} of {entries.length} entries
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="debug-panel-btn"
              title="Copy to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownload}
              className="debug-panel-btn"
              title="Download logs"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleClear}
              className="debug-panel-btn debug-panel-btn-danger"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="debug-panel-btn">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="debug-panel-toolbar">
          {/* Search */}
          <div className="debug-panel-search">
            <Search className="w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="debug-panel-search-input"
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`debug-panel-btn ${showFilters ? 'active' : ''}`}
          >
            <Filter className="w-4 h-4" />
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Auto-scroll toggle */}
          <label className="debug-panel-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
        </div>

        {/* Filters row */}
        {showFilters && (
          <div className="debug-panel-filters">
            {(['all', 'info', 'warn', 'error', 'debug'] as LogFilter[]).map((level) => (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`debug-panel-filter-btn ${filter === level ? 'active' : ''} ${level !== 'all' ? getLevelColor(level as LogEntry['level']) : ''}`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Log entries */}
        <div ref={logContainerRef} className="debug-panel-logs">
          {filteredEntries.length === 0 ? (
            <div className="debug-panel-empty">
              <Bug className="w-8 h-8 text-[var(--text-muted)]" />
              <p>No logs yet</p>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className={`debug-panel-log-entry ${getLevelBg(entry.level)}`}
              >
                <span className="debug-panel-log-time">
                  {entry.timestamp.toLocaleTimeString()}
                </span>
                <span className={`debug-panel-log-level ${getLevelColor(entry.level)}`}>
                  {entry.level.toUpperCase()}
                </span>
                <span className="debug-panel-log-source">[{entry.source}]</span>
                <span className="debug-panel-log-message">{entry.message}</span>
              </div>
            ))
          )}
        </div>

        {/* Copied toast */}
        {copiedToast && (
          <div className="debug-panel-toast">
            <Copy className="w-4 h-4" />
            <span>Copied to clipboard!</span>
          </div>
        )}
      </div>
    </div>
  );
}
