/**
 * Debug Logger for QvMC
 * Captures console logs and allows exporting them for troubleshooting
 */

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  data?: unknown;
}

type LogListener = (entries: LogEntry[]) => void;

class DebugLogger {
  private entries: LogEntry[] = [];
  private maxEntries = 1000;
  private listeners: Set<LogListener> = new Set();
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };

  constructor() {
    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    // Intercept console methods
    this.interceptConsole();
  }

  private interceptConsole() {
    console.log = (...args: unknown[]) => {
      this.addEntry('info', 'console', args);
      this.originalConsole.log(...args);
    };

    console.info = (...args: unknown[]) => {
      this.addEntry('info', 'console', args);
      this.originalConsole.info(...args);
    };

    console.warn = (...args: unknown[]) => {
      this.addEntry('warn', 'console', args);
      this.originalConsole.warn(...args);
    };

    console.error = (...args: unknown[]) => {
      this.addEntry('error', 'console', args);
      this.originalConsole.error(...args);
    };

    console.debug = (...args: unknown[]) => {
      this.addEntry('debug', 'console', args);
      this.originalConsole.debug(...args);
    };
  }

  private addEntry(level: LogEntry['level'], source: string, args: unknown[]) {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      source,
      message,
      data: args.length > 1 ? args : args[0],
    };

    this.entries.push(entry);

    // Trim old entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Notify listeners
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener([...this.entries]);
      } catch (e) {
        this.originalConsole.error('Error in log listener:', e);
      }
    });
  }

  /**
   * Log a message with source context
   */
  log(source: string, level: LogEntry['level'], message: string, data?: unknown) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      level,
      source,
      message,
      data,
    };

    this.entries.push(entry);

    // Also log to console
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    this.originalConsole[consoleMethod](`[${source}]`, message, data ?? '');

    // Trim old entries
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this.notifyListeners();
  }

  /**
   * Get all log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries
   */
  clear() {
    this.entries = [];
    this.notifyListeners();
  }

  /**
   * Subscribe to log updates
   */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    // Call immediately with current entries
    listener([...this.entries]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Export logs as text
   */
  exportAsText(): string {
    return this.entries
      .map((entry) => {
        const time = entry.timestamp.toISOString();
        const level = entry.level.toUpperCase().padEnd(5);
        const source = entry.source.padEnd(12);
        const data = entry.data ? `\n  Data: ${JSON.stringify(entry.data)}` : '';
        return `[${time}] ${level} [${source}] ${entry.message}${data}`;
      })
      .join('\n');
  }

  /**
   * Export logs as JSON
   */
  exportAsJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /**
   * Copy logs to clipboard
   */
  async copyToClipboard(): Promise<void> {
    const text = this.exportAsText();
    await navigator.clipboard.writeText(text);
  }
}

// Singleton instance
export const debugLogger = new DebugLogger();

// Convenience functions
export const vncLog = {
  info: (message: string, data?: unknown) => debugLogger.log('VNC', 'info', message, data),
  warn: (message: string, data?: unknown) => debugLogger.log('VNC', 'warn', message, data),
  error: (message: string, data?: unknown) => debugLogger.log('VNC', 'error', message, data),
  debug: (message: string, data?: unknown) => debugLogger.log('VNC', 'debug', message, data),
};

export const apiLog = {
  info: (message: string, data?: unknown) => debugLogger.log('API', 'info', message, data),
  warn: (message: string, data?: unknown) => debugLogger.log('API', 'warn', message, data),
  error: (message: string, data?: unknown) => debugLogger.log('API', 'error', message, data),
  debug: (message: string, data?: unknown) => debugLogger.log('API', 'debug', message, data),
};
