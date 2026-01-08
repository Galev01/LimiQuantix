# 000046 - OVA/OVF Template Support

**Status:** Implemented  
**Date:** January 2026  
**Author:** AI Assistant  

## Overview

This document describes the OVA (Open Virtual Appliance) template support added to LimiQuantix. OVA files are a packaging format for distributing virtual machine configurations and disk images, commonly exported from VMware, VirtualBox, and other virtualization platforms.

## Features

### Supported Capabilities

- **OVA Upload**: Upload OVA files through the web UI (drag-and-drop support)
- **OVF Parsing**: Automatic extraction and parsing of OVF descriptor XML
- **VMDK Conversion**: Automatic conversion of VMDK disk images to QCOW2 format
- **Hardware Auto-Population**: VM creation wizard auto-populates CPU and memory from OVF metadata
- **Template Library**: View and manage OVA templates in the Image Library

### OVF Properties Extracted

The following properties are extracted from the OVF descriptor:

| Property | Description |
|----------|-------------|
| VM Name | Original VM name from OVF |
| Description | VM description/annotation |
| CPU Count | Number of vCPUs (ResourceType=3) |
| Memory | Memory size in MiB (ResourceType=4) |
| Disk Information | Disk IDs, sizes, formats |
| Network Adapters | Network names and adapter types |
| OS Information | Operating system ID and description |
| Product Info | Vendor, version, URLs |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
├─────────────────────────────────────────────────────────────────┤
│  OVAUploadModal.tsx     │  useOVA.ts hooks      │  ImageLibrary │
│  - Drag & drop upload   │  - useUploadOVA()     │  - OVA tab    │
│  - Progress tracking    │  - useOVAUploadStatus │  - Template   │
│  - Metadata preview     │  - useOVATemplates()  │    cards      │
└─────────────────────────────────────────────────────────────────┘
                                │
                    POST /api/v1/ova/upload
                    GET /api/v1/ova/status/{jobId}
                                │
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
├─────────────────────────────────────────────────────────────────┤
│  ova_upload_handler.go  │  ova_service.go                       │
│  - HTTP multipart upload│  - CreateUploadJob()                  │
│  - File streaming       │  - ProcessOVA()                       │
│                         │  - extractOVA()                       │
│                         │  - parseOVF()                         │
│                         │  - convertDisks()                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                    POST /api/v1/storage/convert
                                │
┌─────────────────────────────────────────────────────────────────┐
│                       Node Daemon                                │
├─────────────────────────────────────────────────────────────────┤
│  http_server.rs                                                  │
│  - convert_disk_format()  (VMDK → QCOW2 via qemu-img)          │
│  - get_conversion_status()                                      │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### HTTP Endpoints (Multipart Upload)

#### Upload OVA File
```
POST /api/v1/ova/upload
Content-Type: multipart/form-data

Request:
  file: <OVA file>

Response (202 Accepted):
{
  "job_id": "uuid",
  "message": "OVA upload accepted, processing started",
  "filename": "example.ova",
  "size": 1234567890
}
```

#### Get Upload Status
```
GET /api/v1/ova/status/{jobId}

Response:
{
  "job_id": "uuid",
  "status": "EXTRACTING" | "PARSING" | "CONVERTING" | "COMPLETED" | "FAILED",
  "progress_percent": 50,
  "current_step": "Converting disk images",
  "bytes_uploaded": 500000000,
  "bytes_total": 1000000000,
  "image_id": "uuid",  // Set after completion
  "error_message": "...",  // Set if failed
  "metadata": {
    "vm_name": "My VM",
    "hardware": { "cpu_count": 4, "memory_mib": 8192 },
    ...
  }
}
```

### Connect-RPC Endpoints

#### List OVA Templates
```protobuf
rpc ListOVATemplates(ListOVATemplatesRequest) returns (ListOVATemplatesResponse);
```

#### Get OVA Template
```protobuf
rpc GetOVATemplate(GetOVATemplateRequest) returns (Image);
```

#### Delete OVA Template
```protobuf
rpc DeleteOVATemplate(DeleteOVATemplateRequest) returns (google.protobuf.Empty);
```

### Node Daemon Endpoints

#### Convert Disk Format
```
POST /api/v1/storage/convert

Request:
{
  "sourcePath": "/path/to/disk.vmdk",
  "destPath": "/path/to/disk.qcow2",
  "sourceFormat": "vmdk",
  "destFormat": "qcow2"
}

Response:
{
  "jobId": "uuid",
  "message": "Conversion started",
  "sourcePath": "...",
  "destPath": "..."
}
```

## Usage

### Uploading an OVA Template

1. Navigate to **Storage** → **Image Library**
2. Click the **Upload OVA** button
3. Drag and drop your `.ova` file or click to browse
4. Wait for the upload and processing to complete
5. The template will appear in the **OVA Templates** tab

### Creating a VM from an OVA Template

1. Navigate to **Virtual Machines** → **Create VM**
2. In the **Boot Media** step, select **OVA Template**
3. Choose your template from the list
4. Hardware specs will be auto-populated from the template
5. Continue through the wizard to create the VM

## Data Model

### Proto Messages

```protobuf
message OvaMetadata {
  string vm_name = 1;
  string description = 2;
  OvaOsInfo os_info = 3;
  OvaHardwareConfig hardware = 4;
  repeated OvaDiskInfo disks = 5;
  repeated OvaNetworkInfo networks = 6;
  OvaProductInfo product = 7;
  string ovf_content = 8;
}

message OvaHardwareConfig {
  uint32 cpu_count = 1;
  uint64 memory_mib = 2;
  string firmware = 3;
}
```

### Domain Model (Go)

```go
type OvaMetadata struct {
    VMName      string            `json:"vm_name"`
    Description string            `json:"description"`
    OsInfo      OvaOsInfo         `json:"os_info"`
    Hardware    OvaHardwareConfig `json:"hardware"`
    Disks       []OvaDiskInfo     `json:"disks"`
    Networks    []OvaNetworkInfo  `json:"networks"`
    Product     OvaProductInfo    `json:"product"`
    OvfContent  string            `json:"ovf_content,omitempty"`
}
```

## Limitations

### Current Release

1. **Single VMDK**: Only the first VMDK disk is processed. Multi-disk OVAs will only use the primary disk.

2. **No OVF Properties**: OVF environment properties (e.g., network configuration) are not passed to the VM.

3. **No Certificate Validation**: OVA manifest signature validation is not implemented.

4. **Maximum File Size**: Default limit is 50 GB (configurable).

5. **VMDK Format Only**: Only VMDK disks are supported. VHD or raw disks in OVAs are not handled.

6. **Local Conversion**: Disk conversion happens on the control plane, not distributed to nodes.

### Future Enhancements

- [ ] Multi-disk OVA support
- [ ] OVF property injection
- [ ] Distributed conversion (send to Node Daemon)
- [ ] OVA signature validation
- [ ] Progress streaming for large files
- [ ] Resume interrupted uploads

## File Locations

| Component | Path |
|-----------|------|
| Proto definitions | `proto/limiquantix/storage/v1/storage.proto` |
| Proto service | `proto/limiquantix/storage/v1/storage_service.proto` |
| Backend domain | `backend/internal/domain/storage.go` |
| Backend service | `backend/internal/services/storage/ova_service.go` |
| Backend handler | `backend/internal/server/ova_upload_handler.go` |
| Node conversion | `agent/limiquantix-node/src/http_server.rs` |
| Frontend modal | `frontend/src/components/storage/OVAUploadModal.tsx` |
| Frontend hooks | `frontend/src/hooks/useOVA.ts` |
| Image Library | `frontend/src/pages/ImageLibrary.tsx` |
| VM Wizard | `frontend/src/components/vm/VMCreationWizard.tsx` |

## OVF Resource Types Reference

| ResourceType | Description |
|--------------|-------------|
| 3 | Processor (CPU) |
| 4 | Memory |
| 5 | IDE Controller |
| 6 | SCSI Controller |
| 10 | Network Adapter |
| 14 | Floppy Drive |
| 15 | CD/DVD Drive |
| 17 | Hard Disk |
| 20 | USB Controller |

## Testing

### Manual Testing

1. Export a VM from VMware/VirtualBox as OVA
2. Upload through the UI
3. Verify metadata is extracted correctly
4. Create a new VM from the template
5. Verify VM boots with correct specs

### Example OVA Sources

- VirtualBox: File → Export Appliance → OVA 2.0
- VMware Workstation: File → Export to OVF → OVA
- VMware vSphere: Deploy OVF Template (export from vCenter)

## References

- [OVF Specification (DMTF)](https://www.dmtf.org/standards/ovf)
- [OVA Format (VMware)](https://docs.vmware.com/en/VMware-vSphere/7.0/com.vmware.vsphere.vm_admin.doc/GUID-AE61948B-C2EE-436E-BAFB-3C7209088552.html)
- [qemu-img Documentation](https://qemu-project.gitlab.io/qemu/tools/qemu-img.html)
