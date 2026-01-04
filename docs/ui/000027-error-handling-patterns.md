# Error Handling Patterns for Frontend

**Document ID:** 000027  
**Date:** January 2026  
**Purpose:** Document standardized error handling patterns for the limiquantix React frontend

---

## Overview

The frontend uses a consistent error handling pattern across all components:

1. **Toast Notifications** - User-facing feedback via `sonner` library
2. **Error Boundaries** - Catch render errors and show fallback UI
3. **Centralized Utilities** - Shared functions for error extraction and display

---

## Toast Utility (`frontend/src/lib/toast.ts`)

### Available Functions

```typescript
import { showSuccess, showError, showWarning, showInfo, withToast } from '@/lib/toast';

// Success notification
showSuccess('VM created successfully');
showSuccess('Operation complete', 'Additional details here');

// Error notification (extracts message from Error objects)
showError(error, 'Failed to create VM');
showError('Something went wrong');

// Warning notification
showWarning('Clone VM feature coming soon');

// Info notification
showInfo('Demo mode: Action simulated');

// Promise-based toast (loading → success/error)
await withToast(
  vmApi.create(data),
  {
    loading: 'Creating VM...',
    success: (vm) => `VM "${vm.name}" created`,
    error: 'Failed to create VM',
  }
);
```

### Error Message Extraction

The `extractErrorMessage()` function handles various error types:
- Standard `Error` objects
- Connect-RPC/gRPC errors with status codes
- String errors
- Objects with `message` property

---

## React Query Mutation Pattern

All mutation hooks follow this standard pattern:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showSuccess, showError } from '@/lib/toast';

export function useCreateVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => vmApi.create(data),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create VM');
    },
  });
}
```

### Key Points

1. **Always include `onError`** - Shows toast with context message
2. **Always include `onSuccess`** - Shows confirmation toast
3. **Use descriptive messages** - Include entity name when available
4. **Invalidate relevant queries** - Keep cache consistent

---

## Page/Component Pattern

When calling mutations from components:

```typescript
// Good: Let the hook handle success/error toasts
const handleStart = async () => {
  if (!isConnected) {
    showInfo('Demo mode: VM start simulated');
    return;
  }
  await startVM.mutateAsync(id);
  // Toast is shown by the hook's onSuccess/onError
};

// Avoid: Don't duplicate toast handling
const handleStart = async () => {
  try {
    await startVM.mutateAsync(id);
    // showSuccess() is already called in the hook!
  } catch (error) {
    // showError() is already called in the hook!
  }
};
```

### Demo Mode Pattern

For pages that fall back to mock data when not connected:

```typescript
const { data: isConnected = false } = useApiConnection();
const useMockData = !isConnected || !apiData;

const handleAction = async () => {
  if (useMockData) {
    showInfo('Demo mode: Action simulated');
    return;
  }
  await mutation.mutateAsync(data);
};
```

---

## Error Boundary (`frontend/src/components/ErrorBoundary.tsx`)

Catches JavaScript errors in the component tree and displays a fallback UI.

### Usage

```tsx
import { RouteErrorBoundary } from '@/components/ErrorBoundary';

// Wrap routes or major sections
<RouteErrorBoundary>
  <MyComponent />
</RouteErrorBoundary>
```

### Features

- **Retry button** - Clears error state and re-renders
- **Go to Dashboard** - Navigation escape hatch
- **Development details** - Shows error message and component stack in dev mode
- **Error tracking hook** - Optional callback for production error reporting

---

## Toaster Configuration

The Toaster is configured in `App.tsx`:

```tsx
<Toaster
  position="bottom-right"
  expand={false}
  richColors
  closeButton
  theme="dark"
  toastOptions={{
    duration: 4000,
    classNames: {
      toast: 'bg-surface border-white/10',
      title: 'text-white',
      description: 'text-gray-400',
    },
  }}
/>
```

### Duration Guidelines

| Type | Duration | Use Case |
|------|----------|----------|
| Success | 4s | Standard confirmations |
| Info | 4s | General information |
| Warning | 5s | User needs to notice |
| Error | 6s | User needs to read/act |
| Loading | Until dismissed | Long operations |

---

## Anti-Patterns to Avoid

### ❌ Using console.log for user feedback

```typescript
// Bad
console.log('VM created:', vm);

// Good
showSuccess(`VM "${vm.name}" created`);
```

### ❌ Swallowing errors silently

```typescript
// Bad
try {
  await api.call();
} catch {
  // Silent failure
}

// Good
try {
  await api.call();
} catch (error) {
  showError(error, 'Failed to complete action');
}
```

### ❌ Generic error messages

```typescript
// Bad
showError(error, 'Error');

// Good
showError(error, 'Failed to create VM');
```

### ❌ Duplicate toast handling

```typescript
// Bad: Toast shown twice
const handleAction = async () => {
  try {
    await mutation.mutateAsync(data);
    showSuccess('Done'); // Hook already shows this!
  } catch (error) {
    showError(error); // Hook already shows this!
  }
};
```

---

## Migration Checklist

When updating a component to use proper error handling:

- [ ] Import `showSuccess`, `showError`, `showInfo`, `showWarning` from `@/lib/toast`
- [ ] Replace all `console.log` statements with appropriate toast function
- [ ] Replace all `console.error` statements with `showError`
- [ ] Ensure mutation hooks have `onSuccess` and `onError` handlers
- [ ] Add demo mode handling with `showInfo` for mock data fallback
- [ ] Remove try/catch blocks around `mutateAsync` if hook handles errors

---

## File Locations

- **Toast utilities**: `frontend/src/lib/toast.ts`
- **Error boundary**: `frontend/src/components/ErrorBoundary.tsx`
- **Toaster setup**: `frontend/src/App.tsx`
- **Example hooks**: `frontend/src/hooks/useVMs.ts`
