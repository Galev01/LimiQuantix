# Update Server Backend Plan

**Document ID:** 000083  
**Date:** January 16, 2026  
**Scope:** Backend implementation plan for Update Server Admin UI

## Current State Analysis

### Working Endpoints ✅

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/v1/channels` | ✅ Working | Returns dev, beta, stable |
| `GET /api/v1/{product}/releases` | ✅ Working | Returns `null` when empty (should return `[]`) |
| `GET /api/v1/admin/status` | ✅ Working | Returns git and server info |
| `POST /api/v1/{product}/publish` | ✅ Working | Multipart upload with auth |
| `DELETE /api/v1/{product}/releases/{version}` | ✅ Working | With auth |
| `POST /api/v1/admin/git-pull` | ✅ Working | Executes git pull |
| `POST /api/v1/admin/build` | ✅ Working | Runs publish script |

### Issues Found 🐛

1. **`/health` and `/api/v1/health` caught by SPA fallback** - Need to fix route order
2. **Releases return `null` instead of `[]`** - Should return empty array
3. **No auth on admin endpoints from UI** - Git pull/build need tokens
4. **Settings page doesn't fetch actual server config** - Shows hardcoded values

---

## Page-by-Page Backend Plan

### 1. Dashboard Page

**Current UI Calls:**
```typescript
GET /api/v1/health           // Broken - returns HTML
GET /api/v1/channels         // ✅ Working
GET /api/v1/quantix-os/releases   // ✅ Working (returns null if empty)
GET /api/v1/quantix-vdc/releases  // ✅ Working
```

**Backend Fixes Required:**

| Task | Priority | Description |
|------|----------|-------------|
| Fix `/health` route | HIGH | Move health check route before SPA fallback |
| Fix empty releases | MEDIUM | Return `[]` instead of `null` when no releases |
| Add disk usage stats | LOW | Return storage usage for dashboard |

**New Endpoint Needed:**
```go
// GET /api/v1/stats
type StatsResponse struct {
    TotalReleases      int     `json:"total_releases"`
    TotalArtifactSize  int64   `json:"total_artifact_size_bytes"`
    OsReleases         int     `json:"os_releases"`
    VdcReleases        int     `json:"vdc_releases"`
    LastPublishTime    *time.Time `json:"last_publish_time"`
}
```

---

### 2. Releases Page

**Current UI Calls:**
```typescript
GET /api/v1/{product}/releases                    // ✅ List releases
GET /api/v1/{product}/releases/{version}/manifest // ✅ Get manifest
DELETE /api/v1/{product}/releases/{version}       // ✅ Delete (needs auth header fix)
```

**Backend Fixes Required:**

| Task | Priority | Description |
|------|----------|-------------|
| Fix delete auth | HIGH | UI sends `Authorization: Bearer token` but doesn't include token |
| Add pagination | MEDIUM | For large release lists |
| Add search/filter | LOW | Filter by version, date range |

**Changes Needed:**

1. **UI Fix**: Add auth header to delete mutation:
```typescript
const deleteRelease = useMutation({
  mutationFn: async ({ version, channel }) => {
    const token = localStorage.getItem('publish_token') || 'dev-token';
    const res = await fetch(`/api/v1/${selectedProduct}/releases/${version}?channel=${channel}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,  // <-- ADD THIS
      },
    });
    if (!res.ok) throw new Error('Failed to delete release');
  },
});
```

---

### 3. Publish Page

**Current UI Calls:**
```typescript
POST /api/v1/admin/git-pull   // ✅ Working but needs auth
POST /api/v1/admin/build      // ✅ Working but needs auth
POST /api/v1/{product}/publish // ✅ Working with auth
```

**Backend Fixes Required:**

| Task | Priority | Description |
|------|----------|-------------|
| Fix git-pull auth | HIGH | UI doesn't send auth token |
| Fix build auth | HIGH | UI doesn't send auth token |
| Auto-calc SHA256 | MEDIUM | Server should calculate if manifest has `sha256: "pending"` |
| Build progress | LOW | WebSocket/SSE for build output streaming |

**UI Fixes Needed:**

```typescript
// Git pull mutation - add auth
const gitPull = useMutation({
  mutationFn: async (): Promise<GitPullResult> => {
    const token = localStorage.getItem('publish_token') || 'dev-token';
    const res = await fetch('/api/v1/admin/git-pull', { 
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,  // <-- ADD THIS
      },
    });
    if (!res.ok) throw new Error('Git pull failed');
    return res.json();
  },
});

// Build mutation - add auth
const buildRelease = useMutation({
  mutationFn: async () => {
    const token = localStorage.getItem('publish_token') || 'dev-token';
    const res = await fetch('/api/v1/admin/build', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,  // <-- ADD THIS
      },
      body: JSON.stringify({ ... }),
    });
    // ...
  },
});
```

**Backend Enhancement - Auto SHA256:**
```go
// In handlePublish, if SHA256 is "pending", calculate it:
if component.SHA256 == "" || component.SHA256 == "pending" {
    actualHash, err := calculateSHA256(artifactPath)
    if err != nil {
        return err
    }
    // Update manifest with actual hash
    component.SHA256 = actualHash
}
```

---

### 4. Settings Page

**Current UI Calls:**
```typescript
// Currently no API calls - hardcoded values
// Token saved to localStorage only
```

**Backend Additions Required:**

| Task | Priority | Description |
|------|----------|-------------|
| Fetch server config | HIGH | New endpoint to get actual config |
| Save config | MEDIUM | Persist some settings (optional) |
| Generate signing keys | MEDIUM | Already exists, add UI button |
| Get public key | MEDIUM | Already exists, show in UI |

**New Endpoint Needed:**
```go
// GET /api/v1/admin/config
type ConfigResponse struct {
    Server struct {
        ListenAddr  string `json:"listen_addr"`
        ReleaseDir  string `json:"release_dir"`
        GitRepoPath string `json:"git_repo_path"`
        UIPath      string `json:"ui_path"`
    } `json:"server"`
    
    Signing struct {
        Enabled   bool   `json:"enabled"`
        KeyID     string `json:"key_id,omitempty"`
        PublicKey string `json:"public_key,omitempty"`
    } `json:"signing"`
    
    Git struct {
        Branch string `json:"branch"`
        Commit string `json:"commit"`
        Status string `json:"status"` // clean, modified
    } `json:"git"`
}
```

**Settings Page Updates:**
- Fetch actual config from `/api/v1/admin/config`
- Show signing status (enabled/disabled)
- Add "Generate Keys" button
- Show public key for embedding in agents

---

## Implementation Priority

### Phase 1: Critical Fixes (Do First)

1. **Fix route order** - `/health` returns HTML instead of JSON
2. **Fix empty releases** - Return `[]` not `null`
3. **Add auth headers to UI** - Delete, git-pull, build mutations

### Phase 2: Core Features

4. **Add `/api/v1/admin/config` endpoint**
5. **Auto-calculate SHA256** when `"pending"`
6. **Settings page fetch actual config**

### Phase 3: Enhancements

7. **Add `/api/v1/stats` endpoint** for dashboard
8. **Pagination for releases**
9. **Build output streaming** (WebSocket/SSE)
10. **Signing key generation UI**

---

## Quick Fix Script

Here are the immediate fixes needed:

### 1. Fix Route Order in main.go

The static file serving must come AFTER API routes:

```go
// Current (broken):
app.Static("/", config.UIPath)
app.Get("/*", func(c *fiber.Ctx) error {
    return c.SendFile(filepath.Join(config.UIPath, "index.html"))
})

// Fixed:
// API routes must be registered FIRST, then static files
// Move app.Static and SPA fallback to AFTER all API routes
```

### 2. Fix Empty Releases Response

```go
// Current:
return c.JSON(releases)  // Returns null if releases is nil

// Fixed:
if releases == nil {
    releases = []ReleaseInfo{}
}
return c.JSON(releases)
```

### 3. Add Config Endpoint

```go
// GET /api/v1/admin/config
func handleGetConfig(c *fiber.Ctx) error {
    return c.JSON(fiber.Map{
        "server": fiber.Map{
            "listen_addr":   config.ListenAddr,
            "release_dir":   config.ReleaseDir,
            "git_repo_path": config.GitRepoPath,
            "ui_path":       config.UIPath,
        },
        "signing": fiber.Map{
            "enabled":    IsSigningEnabled(),
            "key_id":     signingKeyID,
            "public_key": GetPublicKey(),
        },
    })
}
```

---

## Testing Checklist

After implementing fixes:

- [ ] `curl http://localhost:9000/health` returns JSON
- [ ] `curl http://localhost:9000/api/v1/quantix-os/releases` returns `[]` when empty
- [ ] Dashboard shows "Online" status
- [ ] Git Pull button works from Publish page
- [ ] Build button works from Publish page
- [ ] Delete button works from Releases page
- [ ] Settings page shows actual server config
