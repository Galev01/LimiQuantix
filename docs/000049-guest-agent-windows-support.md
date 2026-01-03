# 000049 - Guest Agent Windows Support & Enterprise Features

> **Purpose:** This document details Windows support for the Guest Agent, including VSS quiescing, MSI installer, and additional enterprise features like file browsing and agent self-update.

---

## 1. Summary

This update extends the LimiQuantix Guest Agent with full Windows support and enterprise UI features:

| Feature | Platform | Status |
|---------|----------|--------|
| **VSS Quiescing** | Windows | ✅ Complete |
| **fsfreeze Quiescing** | Linux | ✅ Complete |
| **MSI Installer** | Windows | ✅ Complete |
| **NetworkManager Support** | Linux (RHEL/CentOS) | ✅ Complete |
| **Windows Network Config** | Windows | ✅ Complete |
| **Agent Version Display** | Frontend | ✅ Complete |
| **Agent Update Button** | Frontend | ✅ Complete |
| **File Browser UI** | Frontend | ✅ Complete |

---

## 2. Windows VSS Integration

### 2.1 Overview

Windows uses Volume Shadow Copy Service (VSS) for application-consistent snapshots. Unlike Linux's fsfreeze which freezes at the filesystem level, VSS coordinates with VSS-aware applications (SQL Server, Exchange, etc.) to flush buffers and pause I/O.

### 2.2 Implementation

**File:** `agent/limiquantix-guest-agent/src/handlers/quiesce.rs`

```rust
#[cfg(windows)]
async fn freeze_filesystem(mount_point: &str) -> Result<(), String> {
    // Uses diskshadow with a volatile shadow copy to trigger VSS quiesce
    let volume = normalize_windows_volume(mount_point)?;
    
    let script_content = format!(
        "set context volatile nowriters\n\
         set option differential\n\
         begin backup\n\
         add volume {} alias quiesce_vol\n\
         create\n\
         end backup\n",
        volume
    );
    
    // Write and execute diskshadow script
    let script_path = PathBuf::from(format!(
        "{}\\limiquantix_quiesce_{}.dsh",
        std::env::temp_dir().display(),
        std::process::id()
    ));
    
    fs::write(&script_path, &script_content)?;
    Command::new("diskshadow").arg("/s").arg(&script_path).output().await?;
    
    Ok(())
}
```

**How it works:**
1. Creates a temporary diskshadow script
2. Initiates a volatile shadow copy (triggers VSS writers)
3. VSS coordinates with applications to quiesce
4. Shadow copy is created (quiesce complete)
5. On thaw, shadow copies are deleted via `vssadmin delete shadows`

### 2.3 VSS Writers

VSS automatically coordinates with registered writers:

| Writer | Application |
|--------|-------------|
| SqlServerWriter | Microsoft SQL Server |
| MSDE Writer | SQL Server Express |
| Exchange Writer | Microsoft Exchange |
| Hyper-V Writer | Nested VMs |
| System Writer | System state |

---

## 3. Windows MSI Installer

### 3.1 WiX Configuration

**File:** `agent/limiquantix-guest-agent/packaging/windows/wix/main.wxs`

The MSI installer:
- Installs agent to `C:\Program Files\LimiQuantix\Agent\`
- Registers as a Windows Service (`LimiQuantixAgent`)
- Configures auto-start
- Includes configuration file template

```xml
<ServiceInstall
  Name="LimiQuantixAgent"
  DisplayName="LimiQuantix Guest Agent"
  Description="Provides VM integration for LimiQuantix hypervisor"
  Type="ownProcess"
  Start="auto"
  ErrorControl="normal"
  Account="LocalSystem" />
```

### 3.2 Building the MSI

**File:** `agent/limiquantix-guest-agent/packaging/windows/build-msi.ps1`

```powershell
# Build the MSI
.\build-msi.ps1 -Version "0.1.0" -Configuration "release"
```

**Output:** `output/limiquantix-agent-0.1.0-x64.msi`

### 3.3 Installation

```powershell
# Silent install
msiexec /i limiquantix-agent-0.1.0-x64.msi /quiet /log install.log

# Uninstall
msiexec /x limiquantix-agent-0.1.0-x64.msi /quiet
```

---

## 4. Enhanced Network Configuration

### 4.1 Linux Support

The agent now auto-detects the network manager:

| Distro | Network Manager | Config Format |
|--------|-----------------|---------------|
| Ubuntu 18.04+ | Netplan | YAML |
| Debian 10+ | Netplan | YAML |
| RHEL/CentOS 7+ | NetworkManager | keyfile |
| Fedora | NetworkManager | keyfile |

**Detection Logic:**

```rust
fn detect_network_manager() -> NetworkManager {
    if Path::new("/usr/sbin/netplan").exists() {
        return NetworkManager::Netplan;
    }
    if Path::new("/usr/bin/nmcli").exists() {
        return NetworkManager::NetworkManager;
    }
    NetworkManager::Unknown
}
```

### 4.2 Windows Network Config

Windows uses `netsh` commands:

```
# Example config (one command per line)
interface ip set address "Ethernet" static 192.168.1.100 255.255.255.0 192.168.1.1
interface ip set dns "Ethernet" static 8.8.8.8
```

---

## 5. Frontend Features

### 5.1 Agent Version Display

**File:** `frontend/src/components/vm/GuestAgentStatus.tsx`

Features:
- Shows current agent version with badge
- Highlights when update is available (yellow warning badge)
- Expandable version info panel
- Version comparison logic

```tsx
const isUpdateAvailable = agentInfo?.connected && 
  compareVersions(agentInfo.version, LATEST_AGENT_VERSION) < 0;
```

### 5.2 Agent Update Button

Click "Update Agent" to:
1. Download new binary from server
2. Transfer to VM via guest agent file write
3. Execute upgrade script that replaces binary
4. Restart agent service

The update preserves configuration files.

### 5.3 File Browser

**File:** `frontend/src/components/vm/FileBrowser.tsx`

Full-featured file browser:
- **Navigation:** Breadcrumb path, quick access sidebar
- **Operations:** Download, delete, preview
- **File Preview:** Text files up to 1MB
- **Platform Aware:** Adapts to Windows/Linux paths

Quick Access Locations:
- **Linux:** `/`, `/home`, `/var`, `/etc`, `/tmp`
- **Windows:** `C:\`, `C:\Users`, `C:\Program Files`

---

## 6. Configuration

### 6.1 Windows Agent Config

**File:** `C:\Program Files\LimiQuantix\Agent\config.yaml`

```yaml
device_path: "\\\\?\\Global\\org.limiquantix.agent.0"
log_level: "info"
telemetry_interval_secs: 60
max_exec_timeout_secs: 300
pre_freeze_script_dir: "C:\\ProgramData\\LimiQuantix\\pre-freeze.d"
post_thaw_script_dir: "C:\\ProgramData\\LimiQuantix\\post-thaw.d"
```

### 6.2 Pre/Post Scripts

**Windows:**
- Place `.bat` or `.ps1` scripts in `C:\ProgramData\LimiQuantix\pre-freeze.d\`
- Scripts execute before VSS shadow copy (flush databases)

**Linux:**
- Place executable scripts in `/etc/limiquantix/pre-freeze.d/`
- Scripts run in alphabetical order

---

## 7. API Endpoints

### 7.1 File Operations

```
POST /api/vms/{vmId}/files/list
Body: { "path": "/var/log" }
Response: { "entries": [...] }

POST /api/vms/{vmId}/files/read
Body: { "path": "/etc/hosts" }
Response: { "content": "..." }

POST /api/vms/{vmId}/files/download
Body: { "path": "/var/log/syslog" }
Response: Binary file content

POST /api/vms/{vmId}/files/delete
Body: { "path": "/tmp/old-file.txt" }
Response: { "success": true }
```

### 7.2 Agent Update

```
POST /api/vms/{vmId}/agent/update
Body: {
  "targetVersion": "0.2.0",
  "platform": "linux",
  "architecture": "x86_64"
}
Response: { "success": true }
```

---

## 8. Files Created/Modified

| File | Purpose |
|------|---------|
| `handlers/quiesce.rs` | Added Windows VSS integration |
| `handlers/lifecycle.rs` | Added NetworkManager and Windows netsh support |
| `packaging/windows/wix/main.wxs` | WiX MSI configuration |
| `packaging/windows/wix/config.yaml.template` | Windows config template |
| `packaging/windows/build-msi.ps1` | MSI build script |
| `frontend/src/components/vm/GuestAgentStatus.tsx` | Version display + update |
| `frontend/src/components/vm/FileBrowser.tsx` | **NEW** - File browser UI |
| `frontend/src/pages/VMDetail.tsx` | Added FileBrowser integration |

---

## 9. Testing

### 9.1 Windows VSS

```powershell
# Test VSS manually
vssadmin list writers
diskshadow /c "list shadows all"
```

### 9.2 File Browser

1. Start VM with guest agent installed
2. Go to VM Details → Guest Agent tab
3. Click "Browse Files"
4. Navigate and preview files

### 9.3 Agent Update

1. Deploy a VM with older agent version
2. Open Guest Agent tab
3. Verify "Update Available" badge appears
4. Click "Update Agent" button
5. Wait for agent restart (10 seconds)
6. Verify new version in agent info

---

## 10. Related Documents

| Document | Path |
|----------|------|
| Guest Agent Integration | `docs/000045-guest-agent-integration-complete.md` |
| Guest Agent Architecture | `docs/000044-guest-agent-architecture.md` |
| Console Access | `docs/000042-console-access-implementation.md` |
