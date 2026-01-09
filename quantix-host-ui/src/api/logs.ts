import { get } from './client';

/**
 * Log entry from the system
 */
export interface LogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  fields?: Record<string, unknown>;
  stack_trace?: string;
  request_id?: string;
  vm_id?: string;
  node_id?: string;
  duration_ms?: number;
}

/**
 * Response from logs endpoint
 */
export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  has_more: boolean;
}

/**
 * Parameters for fetching logs
 */
export interface LogsParams {
  level?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

/**
 * Fetch logs from the system
 */
export async function getLogs(params?: LogsParams): Promise<LogsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.level) searchParams.set('level', params.level);
  if (params?.source) searchParams.set('source', params.source);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  if (params?.since) searchParams.set('since', params.since);
  if (params?.until) searchParams.set('until', params.until);
  
  const query = searchParams.toString();
  return get<LogsResponse>(`/logs${query ? `?${query}` : ''}`);
}

/**
 * Get available log sources
 */
export async function getLogSources(): Promise<string[]> {
  return get<string[]>('/logs/sources');
}

/**
 * Stream logs via WebSocket
 * Returns a cleanup function
 */
export function streamLogs(
  onLog: (log: LogEntry) => void,
  onError: (error: Event) => void,
  onOpen?: () => void,
  onClose?: () => void
): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/logs/stream`);
  
  ws.onopen = () => {
    console.log('Log stream connected');
    onOpen?.();
  };
  
  ws.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data) as LogEntry;
      onLog(log);
    } catch (e) {
      console.error('Failed to parse log entry:', e);
    }
  };
  
  ws.onerror = (error) => {
    console.error('Log stream error:', error);
    onError(error);
  };
  
  ws.onclose = () => {
    console.log('Log stream disconnected');
    onClose?.();
  };
  
  return () => {
    ws.close();
  };
}
