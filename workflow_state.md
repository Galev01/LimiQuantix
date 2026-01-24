# Workflow State - Image Persistence & VM Creation Wizard Fix

## Completed Tasks

### 1. Image Persistence (PostgreSQL)

**Problem**: Downloaded images (cloud images and ISOs) were lost after control plane restart because they were stored in-memory.

**Solution**:
- Created new PostgreSQL migration (`backend/migrations/000012_images_extended.up.sql`) with extended schema
- Created PostgreSQL image repository (`backend/internal/repository/postgres/image_repository.go`)
- Updated `server.go` to use PostgreSQL repository when available

**Files Changed**:
- `backend/migrations/000012_images_extended.up.sql` (new)
- `backend/migrations/000012_images_extended.down.sql` (new)
- `backend/internal/repository/postgres/image_repository.go` (new)
- `backend/internal/server/server.go` (modified)

### 2. VM Creation Wizard Image Selection

**Problem**: The VM Creation Wizard wasn't properly fetching and displaying images from the database.

**Solution**:
- Updated `useAvailableImages()` hook to fetch cloud images from DB and merge with catalog
- Updated `useISOs()` hook to properly filter and display ISO images from DB
- Updated `toCloudImage()` to use the actual `path` from the database
- Added `storagePoolId` and proper `nodeId` to CloudImage interface
- Updated StepISO component to show image status (ready/downloading/needs download)
- Added validation to ensure selected image has a valid path before VM creation
- Show image path in the UI when available

**Files Changed**:
- `frontend/src/hooks/useImages.ts` (modified)
- `frontend/src/components/vm/VMCreationWizard.tsx` (modified)

## Pending Tasks

### 3. Pool Sync Mechanism (ISO Scanning Issue Root Cause)

**Problem**: ISO scanning fails because the node daemon doesn't have pool info after restart.

**Root Cause**: 
- Node daemon stores pool info in memory
- After restart, the pool cache is empty
- `try_discover_pool()` only checks standard paths (`/var/lib/limiquantix/pools/{pool_id}`)
- User's NFS pool is at `/srv/nfs/qVDS01` which isn't discovered

**Required Fix**:
- Add pool sync mechanism where control plane pushes pool configs to nodes on connect/reconnect
- Or improve pool discovery to scan all NFS mounts

## Deployment Steps

1. **Apply database migration**:
```bash
cd backend
# Run migration
./migrate -path ./migrations -database "postgres://user:pass@localhost/quantix?sslmode=disable" up
```

2. **Rebuild control plane**:
```bash
cd backend
go build -o bin/controlplane cmd/controlplane/main.go
```

3. **Rebuild frontend**:
```bash
cd frontend
npm run build
```

4. **Restart services** on QvDC machine

## Testing

1. **Image Persistence**:
   - Download a cloud image
   - Restart control plane
   - Verify image is still listed

2. **VM Creation**:
   - Open VM Creation Wizard
   - Go to Boot Media step
   - Verify downloaded images show "Ready" status
   - Verify image path is displayed
   - Select a ready image and complete VM creation

## Log

- Created PostgreSQL image repository with full CRUD operations
- Extended images table schema to match domain model
- Updated frontend hooks to properly fetch and display images from DB
- Added image path display in VM Creation Wizard
- Added validation to ensure selected image is downloaded before VM creation
