import { useState } from 'react';
import { RefreshCw, AlertCircle, AlertTriangle, Info, Bug, Filter } from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useEvents } from '@/hooks/useEvents';
import { cn } from '@/lib/utils';
import type { Event } from '@/api/events';

type EventLevel = 'all' | 'info' | 'warning' | 'error' | 'debug';

export function Events() {
  const { data, isLoading, refetch, isFetching } = useEvents();
  const [levelFilter, setLevelFilter] = useState<EventLevel>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const events = data?.events || [];
  
  // Get unique categories
  const categories = ['all', ...new Set(events.map(e => e.category))];

  // Filter events
  const filteredEvents = events.filter(event => {
    if (levelFilter !== 'all' && event.level !== levelFilter) return false;
    if (categoryFilter !== 'all' && event.category !== categoryFilter) return false;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Events"
        subtitle={`${filteredEvents.length} events`}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Filters */}
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-text-muted" />
              <span className="text-sm text-text-muted">Filters:</span>
            </div>
            
            {/* Level Filter */}
            <div className="flex gap-1">
              {(['all', 'info', 'warning', 'error', 'debug'] as EventLevel[]).map(level => (
                <button
                  key={level}
                  onClick={() => setLevelFilter(level)}
                  className={cn(
                    'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                    levelFilter === level
                      ? 'bg-accent text-white'
                      : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {level === 'all' ? 'All Levels' : level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>

            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 bg-bg-base border border-border rounded-md text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>
        </Card>

        {/* Events List */}
        {isLoading ? (
          <div className="text-center text-text-muted py-12">Loading events...</div>
        ) : filteredEvents.length === 0 ? (
          <Card className="text-center py-12">
            <Info className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <p className="text-text-muted">No events found</p>
            {(levelFilter !== 'all' || categoryFilter !== 'all') && (
              <p className="text-sm text-text-muted mt-2">Try adjusting your filters</p>
            )}
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredEvents.map(event => (
              <EventRow key={event.event_id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface EventRowProps {
  event: Event;
}

function EventRow({ event }: EventRowProps) {
  const [expanded, setExpanded] = useState(false);

  const levelConfig = {
    info: {
      icon: <Info className="w-4 h-4" />,
      variant: 'info' as const,
      bg: 'bg-info/10',
    },
    warning: {
      icon: <AlertTriangle className="w-4 h-4" />,
      variant: 'warning' as const,
      bg: 'bg-warning/10',
    },
    error: {
      icon: <AlertCircle className="w-4 h-4" />,
      variant: 'error' as const,
      bg: 'bg-error/10',
    },
    debug: {
      icon: <Bug className="w-4 h-4" />,
      variant: 'default' as const,
      bg: 'bg-bg-base',
    },
  };

  const config = levelConfig[event.level] || levelConfig.info;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:bg-bg-hover/50',
        config.bg
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-4">
        <div className={cn('mt-0.5', config.variant === 'info' ? 'text-info' : config.variant === 'warning' ? 'text-warning' : config.variant === 'error' ? 'text-error' : 'text-text-muted')}>
          {config.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={config.variant}>{event.level}</Badge>
            <Badge variant="default">{event.category}</Badge>
            <span className="text-xs text-text-muted ml-auto">
              {new Date(event.timestamp).toLocaleString()}
            </span>
          </div>
          <p className="text-text-primary">{event.message}</p>
          <p className="text-xs text-text-muted mt-1">Source: {event.source}</p>
          
          {expanded && event.details && (
            <div className="mt-3 p-3 bg-bg-base rounded-lg overflow-x-auto">
              <pre className="text-xs text-text-secondary">
                {JSON.stringify(event.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
