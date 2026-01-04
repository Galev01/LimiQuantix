# Workflow State: Fix Cloud-Init Boot Issue for Ubuntu Cloud Images

## Problem

When creating a VM from an Ubuntu cloud image, the VM fails to boot properly and falls back to iPXE network boot with the error:
- "Nothing to boot: No such file or directory"

## Root Cause Analysis

1. **Cloud images require cloud-init data** - Ubuntu/Debian cloud images expect a NoCloud datasource (ISO with `meta-data`, `user-data`, `network-config`)

2. **The cloud-init ISO is not being generated or attached** - The proto defines `CloudInitConfig cloud_init = 12` in `VMSpec`, but the service code doesn't process it

3. **Current flow**:
   - Disk is created with backing file (cloud image) ✓
   - VM boots but cloud-init can't find configuration
   - Cloud-init fails, boot hangs or falls back to network boot

## Solution

Modify `agent/limiquantix-node/src/service.rs` to:
1. Check for `cloud_init` config in the request
2. Generate a cloud-init ISO using `CloudInitGenerator`
3. Add the ISO as a CDROM device in the VM config

## Files to Modify

1. **`agent/limiquantix-node/src/service.rs`**:
   - Add import for `CloudInitConfig` and `CloudInitGenerator`
   - Process `spec.cloud_init` field
   - Generate ISO and attach as CDROM

2. **`agent/limiquantix-hypervisor/src/types.rs`** (if needed):
   - Verify CDROM config struct is complete

## Status: IN PROGRESS
