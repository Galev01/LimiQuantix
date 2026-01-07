/**
 * Events API - Endpoints for system events
 */

import { get } from './client';

/**
 * Event response from the API
 */
export interface Event {
  event_id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  category: string;
  message: string;
  source: string;
  details?: Record<string, unknown>;
}

/**
 * Event list response
 */
export interface EventListResponse {
  events: Event[];
  total_count: number;
}

/**
 * List all events
 */
export async function listEvents(): Promise<EventListResponse> {
  return get<EventListResponse>('/events');
}
