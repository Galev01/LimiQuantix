# 000023 - API Client Infrastructure Documentation

**Component**: Connect-ES/gRPC Client  
**Location**: `frontend/src/lib/api-client.ts`, `frontend/src/hooks/useApiConnection.ts`  
**Status**: ✅ Complete  

---

## Overview

The API client infrastructure provides a robust foundation for communicating with the limiquantix backend gRPC services using Connect-ES. It supports unary calls, streaming, authentication, and automatic reconnection.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      React Components                        │
├─────────────────────────────────────────────────────────────┤
│                    Custom Hooks                              │
│         useApiConnection    useStream                        │
├─────────────────────────────────────────────────────────────┤
│                    API Client                                │
│     createApiClient    withRetry    createStreamSubscription │
├─────────────────────────────────────────────────────────────┤
│                    Transport Layer                           │
│          Connect-ES Transport with Interceptors              │
├─────────────────────────────────────────────────────────────┤
│                    gRPC Backend                              │
│                   limiquantix Services                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration

```typescript
const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  timeout: 30000,      // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000,    // 1 second
};
```

---

## Interceptors

### Logging Interceptor

Logs all requests and responses with timing:

```typescript
const loggingInterceptor: Interceptor = (next) => async (req) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  
  console.debug(`[API] Request ${requestId}:`, {
    method: req.method.name,
    service: req.service.typeName,
  });

  try {
    const response = await next(req);
    console.debug(`[API] Response ${requestId}:`, {
      duration: `${Date.now() - startTime}ms`,
    });
    return response;
  } catch (error) {
    console.error(`[API] Error ${requestId}:`, { error });
    throw error;
  }
};
```

### Auth Interceptor

Adds authentication headers:

```typescript
const authInterceptor: Interceptor = (next) => async (req) => {
  if (authToken) {
    req.header.set('Authorization', `Bearer ${authToken}`);
  }
  req.header.set('X-Request-ID', crypto.randomUUID());
  return next(req);
};
```

---

## Client Factory

Create typed clients for any service:

```typescript
import { VMService } from '@/api/limiquantix/compute/v1/vm_service_connect';

const vmClient = createApiClient(VMService);
const vm = await vmClient.getVM({ id: 'vm-123' });
```

---

## Connection Status Management

Track connection state across the application:

```typescript
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

interface ConnectionStatus {
  state: ConnectionState;
  lastConnected: Date | null;
  lastError: Error | null;
  retryCount: number;
}
```

### Usage

```typescript
import { useApiConnection } from '@/hooks/useApiConnection';

function ConnectionIndicator() {
  const { isConnected, isConnecting, hasError, reconnect } = useApiConnection();
  
  if (isConnecting) return <Spinner />;
  if (hasError) return <ErrorBanner onClick={reconnect} />;
  return <GreenDot />;
}
```

---

## Retry Logic

Automatic retries with exponential backoff:

```typescript
const result = await withRetry(
  () => vmClient.getVM({ id }),
  {
    maxAttempts: 3,
    delay: 1000,
    onRetry: (attempt, error) => {
      console.log(`Retry ${attempt}:`, error.message);
    },
  }
);
```

---

## Streaming Support

Subscribe to real-time updates:

```typescript
const subscription = createStreamSubscription(
  () => vmClient.watchVM({ vmId: 'vm-123' })
);

subscription.subscribe((update) => {
  console.log('VM updated:', update);
});

// Later, unsubscribe
subscription.unsubscribe();
```

### React Hook

```typescript
import { useStream } from '@/hooks/useApiConnection';

function VMMonitor({ vmId }: { vmId: string }) {
  const { data, error, isStreaming } = useStream(
    () => vmClient.watchVM({ vmId }),
    {
      enabled: true,
      onData: (vm) => console.log('New data:', vm),
    }
  );
  
  if (isStreaming) return <StreamingIndicator />;
  if (error) return <Error error={error} />;
  return <VMDisplay vm={data} />;
}
```

---

## File Locations

| File | Purpose |
|------|---------|
| `src/lib/api-client.ts` | Core client, transport, interceptors |
| `src/hooks/useApiConnection.ts` | React hooks for connection/streaming |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8080` | Backend API base URL |

---

## Integration with Proto-Generated Code

Once proto code is generated, usage looks like:

```typescript
// Import generated service and client factory
import { VMService } from '@/api/limiquantix/compute/v1/vm_service_connect';
import { createApiClient } from '@/lib/api-client';

// Create client
const vmClient = createApiClient(VMService);

// Use in component
function VMList() {
  const { data, isLoading } = useQuery({
    queryKey: ['vms'],
    queryFn: () => vmClient.listVMs({ pageSize: 100 }),
  });
  
  // ...
}
```

---

## Future Enhancements

1. WebSocket fallback for environments without HTTP/2
2. Request caching layer
3. Offline support with request queueing
4. Request cancellation
5. Metrics and telemetry
6. Circuit breaker pattern
7. Token refresh handling
8. Request batching

