# Workflow State - Agent Renaming

## Status: ✅ COMPLETE (January 27, 2026)

Renamed guest agent from `limiquantix-agent` to `quantix-kvm-agent` across the entire codebase.

---

## Completed: Agent Renaming (`limiquantix-agent` → `quantix-kvm-agent`)

### Changes Summary

**Binary Name:**
- Old: `limiquantix-agent`
- New: `quantix-kvm-agent`

**Config Paths (Guest Agent):**
- Old: `/etc/limiquantix/agent.yaml`
- New: `/etc/quantix-kvm/agent.yaml`

**Log Paths (Guest Agent):**
- Old: `/var/log/limiquantix/`
- New: `/var/log/quantix-kvm/`

**Service Name:**
- Old: `limiquantix-agent.service`
- New: `quantix-kvm-agent.service`

**Socket Paths (Hypervisor):**
- Old: `/var/run/limiquantix/vms/{vm_id}.agent.sock`
- New: `/var/run/quantix-kvm/vms/{vm_id}.agent.sock`

**Virtio-Serial Port:**
- Old: `org.limiquantix.agent.0`
- New: `org.quantix.agent.0`

---

### Files Modified

| Category | Files |
|----------|-------|
| **Rust Guest Agent** | `Cargo.toml`, `config.rs`, `systemd service file` |
| **Rust Node Daemon** | `http_server.rs`, `agent_client.rs` |
| **Rust Hypervisor** | `xml.rs` (socket path only) |
| **Go Backend** | `agent_download.go` |
| **Go Update Server** | `main.go` |
| **Frontend (QvDC)** | `VMCreationWizard.tsx` |
| **Frontend (QHCI)** | `CreateVMWizard.tsx` |
| **Packaging - Debian** | `postinst`, `prerm`, `rules` |
| **Packaging - RPM** | Created new `quantix-kvm-agent.spec` |
| **Packaging - Windows** | `setup.iss`, `main.wxs`, `build-msi.ps1`, `config.yaml.template` |
| **Packaging - Cloud-Init** | `install-agent.yaml` |
| **Packaging - ISO** | `install.sh`, build scripts |
| **Build Scripts** | `build-agent-iso.sh` |
| **CI/CD** | `.github/workflows/guest-agent.yml` |
| **Docker** | `Dockerfile.guest-agent` |
| **Documentation** | `README.md` in guest-agent, `agent.yaml` config |

---

### Key Path Mappings

| Component | Old Path | New Path |
|-----------|----------|----------|
| Binary | `/usr/local/bin/limiquantix-agent` | `/usr/local/bin/quantix-kvm-agent` |
| Config (Linux) | `/etc/limiquantix/agent.yaml` | `/etc/quantix-kvm/agent.yaml` |
| Config (Windows) | `C:\ProgramData\LimiQuantix\` | `C:\ProgramData\Quantix-KVM\` |
| Logs (Linux) | `/var/log/limiquantix/` | `/var/log/quantix-kvm/` |
| Logs (Windows) | `C:\ProgramData\LimiQuantix\Logs\` | `C:\ProgramData\Quantix-KVM\Logs\` |
| Pre-freeze hooks | `/etc/limiquantix/pre-freeze.d/` | `/etc/quantix-kvm/pre-freeze.d/` |
| Post-thaw hooks | `/etc/limiquantix/post-thaw.d/` | `/etc/quantix-kvm/post-thaw.d/` |
| VM sockets | `/var/run/limiquantix/vms/` | `/var/run/quantix-kvm/vms/` |

---

### Node Daemon Paths (Unchanged)

The node daemon running on Quantix-OS hosts keeps its existing paths:
- `/etc/limiquantix/node.yaml`
- `/var/log/limiquantix/node.log`
- `/etc/limiquantix/certs/`

These are host-side paths, not guest agent paths.

---

### Breaking Change

The virtio-serial port name changed from `org.limiquantix.agent.0` to `org.quantix.agent.0`. Existing VMs will need to be recreated for the agent to connect.

---

## Previous Work: Agent Tools ISO Implementation

The ISO-based agent installation created in the previous session now uses the new `quantix-kvm-agent` name throughout.

---

## Previous Workflow States

(Moved to completed_workflow.md)
