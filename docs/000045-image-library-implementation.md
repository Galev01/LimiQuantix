# 000045 - Image Library Implementation

**Purpose:** Document the Image Library API for managing cloud images with automated cloud-init provisioning.

**Status:** ✅ Implemented

---

## Executive Summary

The Image Library provides a centralized way to manage OS images for VM provisioning. It includes:

1. **Built-in Cloud Image Catalog** - Pre-configured popular Linux distributions
2. **Dynamic Image Discovery** - Node Daemon scans local images and registers them
3. **Cloud-Init Integration** - Automatic user configuration with correct default usernames
4. **Image Download API** - Download images from official sources to nodes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                                │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │ VMCreationWizard│────▶│  useImages Hook │────▶│  CLOUD_IMAGE_CATALOG    ││
│  │  - Cloud Image  │     │  - API fallback │     │  (built-in catalog)     ││
│  │  - Cloud-Init   │     │  - Default users│     │                         ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ Connect-RPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │  ImageService   │────▶│ ImageRepository │────▶│   Built-in Catalog      ││
│  │  - List/Get     │     │  (in-memory)    │     │   - Ubuntu 22.04/24.04  ││
│  │  - Import       │     │                 │     │   - Debian 12           ││
│  │  - Download     │     │                 │     │   - Rocky/Alma 9        ││
│  │  - ScanLocal    │     │                 │     │   - Fedora 40, CentOS 9 ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ gRPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Node Daemon (Rust)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  Local Storage: /var/lib/limiquantix/cloud-images/                      ││
│  │    ├── ubuntu-22.04.qcow2                                               ││
│  │    ├── ubuntu-24.04.qcow2                                               ││
│  │    ├── debian-12.qcow2                                                  ││
│  │    └── rocky-9.qcow2                                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cloud Image Catalog

### Supported Images

| Distribution | Version | Catalog ID | Default User | Cloud-Init |
|-------------|---------|------------|--------------|------------|
| Ubuntu | 22.04 LTS | `ubuntu-22.04` | `ubuntu` | ✅ |
| Ubuntu | 24.04 LTS | `ubuntu-24.04` | `ubuntu` | ✅ |
| Debian | 12 (Bookworm) | `debian-12` | `debian` | ✅ |
| Rocky Linux | 9 | `rocky-9` | `rocky` | ✅ |
| AlmaLinux | 9 | `almalinux-9` | `almalinux` | ✅ |
| Fedora | 40 | `fedora-40` | `fedora` | ✅ |
| CentOS Stream | 9 | `centos-stream-9` | `cloud-user` | ✅ |
| openSUSE Leap | 15.5 | `opensuse-leap-15.5` | `root` | ✅ |

### Default Users by Distribution

This is critical for cloud-init configuration. [Per official documentation](https://askubuntu.com/questions/451673/default-username-password-for-ubuntu-cloud-image), cloud images have **no default password** and require cloud-init for user setup.

```typescript
// Default username mapping
const defaultUsers = {
  ubuntu: 'ubuntu',
  debian: 'debian',
  rocky: 'rocky',
  almalinux: 'almalinux',
  centos: 'cloud-user',
  fedora: 'fedora',
  opensuse: 'root',
  rhel: 'cloud-user',
  windows: 'Administrator',
};
```

---

## API Reference

### Proto Definitions

**storage/v1/storage_service.proto**

```protobuf
service ImageService {
  // CRUD
  rpc CreateImage(CreateImageRequest) returns (Image);
  rpc GetImage(GetImageRequest) returns (Image);
  rpc ListImages(ListImagesRequest) returns (ListImagesResponse);
  rpc UpdateImage(UpdateImageRequest) returns (Image);
  rpc DeleteImage(DeleteImageRequest) returns (google.protobuf.Empty);
  
  // Import from URL (async)
  rpc ImportImage(ImportImageRequest) returns (ImportImageResponse);
  rpc GetImportStatus(GetImportStatusRequest) returns (ImportStatus);
  
  // Node Daemon integration
  rpc ScanLocalImages(ScanLocalImagesRequest) returns (ScanLocalImagesResponse);
  rpc DownloadImage(DownloadImageRequest) returns (DownloadImageResponse);
}
```

### OsInfo with Cloud-Init Support

```protobuf
message OsInfo {
  OsFamily family = 1;           // LINUX, WINDOWS, BSD
  string distribution = 2;       // "ubuntu", "debian", "rocky"
  string version = 3;            // "22.04", "12", "9"
  string architecture = 4;       // "x86_64", "aarch64"
  string default_user = 5;       // "ubuntu", "debian", "rocky"
  bool cloud_init_enabled = 6;   // true for cloud images
  ProvisioningMethod provisioning_method = 7;  // CLOUD_INIT, SYSPREP, etc.
}
```

---

## Implementation Files

### Backend (Go)

| File | Purpose |
|------|---------|
| `backend/internal/services/storage/image_service.go` | ImageService implementation with catalog |
| `backend/internal/services/storage/image_repository.go` | In-memory image repository |
| `backend/internal/domain/storage.go` | Domain models with ProvisioningMethod |
| `proto/limiquantix/storage/v1/storage.proto` | OsInfo with cloud-init fields |
| `proto/limiquantix/storage/v1/storage_service.proto` | ImageService RPC definitions |

### Frontend (React/TypeScript)

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useImages.ts` | React hooks for image API + catalog |
| `frontend/src/components/vm/VMCreationWizard.tsx` | Updated to use dynamic images |

---

## Frontend Hook Usage

### List Available Images

```typescript
import { useAvailableImages, formatImageSize, getDefaultUser } from '@/hooks/useImages';

function CloudImageSelector() {
  const { images, isLoading, isUsingCatalog } = useAvailableImages();

  return (
    <div>
      {isUsingCatalog && (
        <p className="warning">Using built-in catalog. Download images for better performance.</p>
      )}
      {images.map(image => (
        <div key={image.id}>
          <h4>{image.name}</h4>
          <p>Default user: {image.os.defaultUser}</p>
          <p>Size: {formatImageSize(image.sizeBytes)}</p>
        </div>
      ))}
    </div>
  );
}
```

### Import Image from URL

```typescript
import { useImportImage } from '@/hooks/useImages';

function ImportImageForm() {
  const importImage = useImportImage();

  const handleImport = async () => {
    const result = await importImage.mutateAsync({
      name: 'My Custom Image',
      url: 'https://example.com/image.qcow2',
      osInfo: {
        family: 1, // LINUX
        distribution: 'ubuntu',
        version: '22.04',
        architecture: 'x86_64',
        defaultUser: 'ubuntu',
      },
    });
    console.log('Import job started:', result.jobId);
  };

  return <button onClick={handleImport}>Import</button>;
}
```

### Download from Catalog

```typescript
import { useDownloadImage } from '@/hooks/useImages';

function DownloadImageButton() {
  const downloadImage = useDownloadImage();

  const handleDownload = async () => {
    await downloadImage.mutateAsync({
      catalogId: 'ubuntu-22.04',
      nodeId: 'node-123',  // Optional: specific node
    });
  };

  return <button onClick={handleDownload}>Download Ubuntu 22.04</button>;
}
```

---

## VM Creation with Cloud Images

When creating a VM with a cloud image, the system:

1. **Selects the cloud image** from the catalog or API
2. **Sets the default user** automatically based on the distribution
3. **Generates cloud-init user-data** with:
   - Hostname configuration
   - User creation with sudo access
   - SSH key injection
   - Package updates and qemu-guest-agent installation
4. **Creates the VM disk** using the cloud image as a backing file (copy-on-write)
5. **Attaches cloud-init ISO** with the configuration

### Cloud-Init User-Data Example

```yaml
#cloud-config
hostname: my-vm
fqdn: my-vm.local
manage_etc_hosts: true

users:
  - name: ubuntu
    groups: sudo
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-rsa AAAAB3NzaC1yc2E...

package_update: true
packages:
  - qemu-guest-agent

runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
```

---

## Node Setup

### Download Cloud Images to Node

```bash
# On the hypervisor node
sudo mkdir -p /var/lib/limiquantix/cloud-images

# Download Ubuntu 22.04
wget -O /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2 \
  https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# Download Debian 12
wget -O /var/lib/limiquantix/cloud-images/debian-12.qcow2 \
  https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2

# Download Rocky 9
wget -O /var/lib/limiquantix/cloud-images/rocky-9.qcow2 \
  https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2
```

### Verify Images

```bash
# Check image format and size
qemu-img info /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2

# Output:
# image: /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2
# file format: qcow2
# virtual size: 2.2 GiB (2361393152 bytes)
# disk size: 669 MiB
# cluster_size: 65536
```

---

## Image Library UI (Completed)

A dedicated Image Library page has been implemented at `/storage/images`:

### Features

- **Cloud Catalog Tab** - Browse and download official cloud images
- **Local Images Tab** - View images downloaded to nodes
- **Real-time Progress** - Download progress bar with percentage
- **Distribution Logos** - Visual identification of OS distributions
- **Verified Badge** - Indicates official/verified images
- **Search Filtering** - Quick search by name or distribution

### React Components

```typescript
// frontend/src/pages/ImageLibrary.tsx
export default function ImageLibrary() {
  const { data: localImages } = useImages();
  const { data: catalogImages } = useImageCatalog();
  const downloadImage = useDownloadImage();
  
  // Tabs: 'catalog' | 'local'
  // Real-time download progress via useImportStatus(jobId)
}
```

### Navigation

Added to sidebar under Storage section:
- Storage Pools
- Volumes
- **Image Library** (new)

---

## Download Manager (Backend)

The backend includes a `DownloadManager` for tracking download jobs:

```go
// backend/internal/services/storage/download_manager.go
type DownloadJob struct {
    ID              string
    ImageID         string
    CatalogID       string
    URL             string
    TargetPath      string
    NodeID          string
    Status          string  // pending, downloading, completed, failed
    ProgressPercent uint32
    BytesDownloaded uint64
    BytesTotal      uint64
    ErrorMessage    string
}
```

### Progress Streaming

The Node Daemon proto supports streaming download progress:

```protobuf
// proto/limiquantix/node/v1/node_daemon.proto
rpc DownloadImage(DownloadImageOnNodeRequest) returns (stream DownloadProgress);

message DownloadProgress {
    string job_id = 1;
    string image_id = 2;
    Status status = 3;  // PENDING, DOWNLOADING, VERIFYING, COMPLETED, FAILED
    uint32 progress_percent = 4;
    uint64 bytes_downloaded = 5;
    uint64 bytes_total = 6;
    uint64 download_speed = 7;  // bytes per second
    uint32 eta_seconds = 8;
    string path = 9;
    string error = 10;
}
```

---

## Node Daemon Image Scanning

The Node Daemon scans for local images during registration:

```rust
// agent/limiquantix-node/src/registration.rs
async fn sync_images(&self, node_id: &str) -> anyhow::Result<()> {
    // Scan /var/lib/limiquantix/cloud-images
    // Detect OS from filename (ubuntu, debian, rocky, etc.)
    // Report to control plane via ScanLocalImages RPC
}
```

### OS Detection from Filename

```rust
fn detect_os_from_filename(filename: &str) -> DetectedOs {
    // ubuntu-22.04.qcow2 -> ubuntu, 22.04, "ubuntu"
    // debian-12.qcow2 -> debian, 12, "debian"
    // rocky-9.qcow2 -> rocky, 9, "rocky"
}
```

---

## Future Enhancements

1. ~~**Image Download in UI**~~ ✅ Completed
2. **Image Conversion** - Convert VMDK/VHD to QCOW2 automatically
3. **Image Checksums** - Verify downloaded images against SHA256
4. **Shared Storage** - Distribute images across Ceph/NFS automatically
5. **Image Templates** - Create templates from existing VMs
6. **Windows Images** - Support Windows Server with Sysprep/Cloudbase-Init

---

## References

- [Ubuntu Cloud Images](https://cloud-images.ubuntu.com/)
- [Debian Cloud Images](https://cloud.debian.org/images/cloud/)
- [Rocky Linux Cloud Images](https://rockylinux.org/cloud-images/)
- [AlmaLinux Cloud Images](https://wiki.almalinux.org/cloud/Generic-cloud.html)
- [Cloud-Init Documentation](https://cloudinit.readthedocs.io/)
- [Default User Question on Ask Ubuntu](https://askubuntu.com/questions/451673/default-username-password-for-ubuntu-cloud-image)
