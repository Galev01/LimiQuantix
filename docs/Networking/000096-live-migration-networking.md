# 000096 - Live Migration Network Port Binding

**Purpose:** Document the atomic OVN port binding transfer during VM live migration to prevent network blackholes.

**Status:** ✅ Implemented

---

## Executive Summary

When a VM migrates between hypervisor nodes, the OVN port binding must transfer atomically to prevent network disruption. Incorrect timing causes:

- **Early Claim**: Destination claims port while VM still runs on source → packets go to wrong node
- **Late Release**: Source holds port after VM moved → packets still go to old node
- **Result**: Network blackhole during migration

The Migration Port Binding Service ensures atomic handoff with zero packet loss.

---

## The Problem

### Without Proper Coordination

```
Time →
Source Node    [======= VM Running =======]----(VM Stops)
Dest Node                                      [==== VM Running ====]
Port Binding   [====== Source ======]....gap....[====== Dest ======]
                                      ↑
                                      │
                              NETWORK BLACKHOLE
                              Packets dropped!
```

### With Atomic Handoff

```
Time →
Source Node    [======= VM Running =======]
Dest Node                                 [==== VM Running ====]
Port Binding   [====== Source ======][====== Dest ======]
                                     ↑
                                     │
                              ATOMIC SWITCH
                              No packet loss!
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Control Plane                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  MigrationPortBindingService (migration.go)                        │  │
│  │                                                                    │  │
│  │  PrepareMigration()     → Set up shadow binding on destination    │  │
│  │  RequestPortClaim()     → Destination requests ownership          │  │
│  │  SwitchPortBinding()    → Atomic switch in OVN Southbound DB      │  │
│  │  RollbackMigration()    → Restore source binding on failure       │  │
│  │  CleanupMigration()     → Remove temporary state                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                            │                                             │
│                            ▼                                             │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  OVN Southbound DB                                                 │  │
│  │  - Port_Binding table                                              │  │
│  │  - Chassis assignments                                             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        Hypervisor Nodes                                  │
│                                                                          │
│  ┌──────────────────────┐          ┌──────────────────────┐             │
│  │  Source Node         │          │  Destination Node    │             │
│  │                      │          │                      │             │
│  │  ┌────────────────┐  │  migrate │  ┌────────────────┐  │             │
│  │  │  VM Instance   │──┼──────────┼─▶│  VM Instance   │  │             │
│  │  └────────────────┘  │          │  └────────────────┘  │             │
│  │         │            │          │         │            │             │
│  │         ▼            │          │         ▼            │             │
│  │  ┌────────────────┐  │          │  ┌────────────────┐  │             │
│  │  │  OVS Port      │  │          │  │  OVS Port      │  │             │
│  │  │  (active)      │  │   switch │  │  (standby)     │  │             │
│  │  │        ────────┼──┼──────────┼──▶      (active)  │  │             │
│  │  └────────────────┘  │          │  └────────────────┘  │             │
│  └──────────────────────┘          └──────────────────────┘             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Migration Phases

### Phase 1: Prepare Migration

```go
func (s *MigrationPortBindingService) PrepareMigration(
    ctx context.Context,
    portID, sourceNode, destNode string,
) (*MigrationState, error) {
    // 1. Verify port is bound to source
    currentChassis, _ := s.getPortChassis(ctx, portID)
    if currentChassis != sourceNode {
        return nil, fmt.Errorf("port not bound to source")
    }
    
    // 2. Set up shadow binding on destination (OVN 21.03+)
    s.prepareDestinationBinding(ctx, portID, destNode)
    
    // 3. Return migration state
    return &MigrationState{
        PortID:        portID,
        SourceChassis: sourceNode,
        DestChassis:   destNode,
        Phase:         MigrationPhasePrepareDest,
    }, nil
}
```

### Phase 2: VM Memory Transfer

During this phase (handled by libvirt):
- VM continues running on source
- Memory pages copied to destination
- Dirty pages re-copied iteratively
- Port binding unchanged

### Phase 3: Request Port Claim

```go
func (s *MigrationPortBindingService) RequestPortClaim(
    ctx context.Context,
    state *MigrationState,
) error {
    // Signal to OVN that destination wants the port
    cmd := exec.CommandContext(ctx, "ovn-nbctl",
        "set", "Logical_Switch_Port", state.PortID,
        fmt.Sprintf("options:requested-chassis=%s", state.DestChassis),
    )
    
    return cmd.Run()
}
```

### Phase 4: Atomic Switch

```go
func (s *MigrationPortBindingService) SwitchPortBinding(
    ctx context.Context,
    state *MigrationState,
) error {
    // Direct update to Southbound DB for atomic switch
    cmd := exec.CommandContext(ctx, "ovn-sbctl",
        "--", "set", "Port_Binding", state.PortID,
        fmt.Sprintf("chassis=%s", state.DestChassis),
    )
    
    if err := cmd.Run(); err != nil {
        return err
    }
    
    // Verify switch succeeded
    newChassis, _ := s.getPortChassis(ctx, state.PortID)
    if newChassis != state.DestChassis {
        return fmt.Errorf("port binding verification failed")
    }
    
    state.Phase = MigrationPhaseComplete
    return nil
}
```

### Phase 5: Cleanup

```go
func (s *MigrationPortBindingService) CleanupMigration(
    ctx context.Context,
    state *MigrationState,
) error {
    // Remove requested-chassis option
    cmd := exec.CommandContext(ctx, "ovn-nbctl",
        "remove", "Logical_Switch_Port", state.PortID,
        "options", "requested-chassis",
    )
    cmd.Run() // Ignore error if option doesn't exist
    
    return nil
}
```

---

## Rollback Handling

If migration fails, roll back port binding:

```go
func (s *MigrationPortBindingService) RollbackMigration(
    ctx context.Context,
    state *MigrationState,
) error {
    // 1. Switch port binding back to source
    cmd := exec.CommandContext(ctx, "ovn-sbctl",
        "--", "set", "Port_Binding", state.PortID,
        fmt.Sprintf("chassis=%s", state.SourceChassis),
    )
    cmd.Run()
    
    // 2. Clear requested-chassis
    cmd = exec.CommandContext(ctx, "ovn-nbctl",
        "remove", "Logical_Switch_Port", state.PortID,
        "options", "requested-chassis",
    )
    cmd.Run()
    
    state.Phase = MigrationPhaseRolledBack
    return nil
}
```

---

## OVN Commands Reference

### Check Current Port Binding

```bash
# Find which chassis owns a port
ovn-sbctl --bare --columns=chassis find Port_Binding logical_port=vm-port-1

# List all port bindings on a chassis
ovn-sbctl find Port_Binding chassis=<chassis-uuid>
```

### Set Requested Chassis

```bash
# Signal intent to move port
ovn-nbctl set Logical_Switch_Port vm-port-1 options:requested-chassis=node-2-chassis
```

### Direct Chassis Update (Atomic)

```bash
# Switch port binding immediately
ovn-sbctl set Port_Binding vm-port-1 chassis=node-2-chassis
```

### Additional Chassis (Shadow Binding)

```bash
# OVN 21.03+: Create shadow binding on destination
ovn-nbctl add Logical_Switch_Port vm-port-1 options additional-chassis=node-2-chassis
```

---

## Integration with VM Migration

### Migration Event Flow

```
1. libvirt: Start live migration
2. Control Plane: PrepareMigration()
3. libvirt: Transfer VM memory
4. libvirt: Pause VM on source
5. libvirt: Resume VM on destination
6. Rust Agent: Detect VM running on destination
7. Rust Agent: Notify control plane
8. Control Plane: SwitchPortBinding()
9. Control Plane: CleanupMigration()
```

### Rust Agent Handler

```rust
// agent/limiquantix-node/src/migration.rs

pub async fn on_vm_arrived(&self, vm_id: &str) -> Result<()> {
    // Wait for libvirt to confirm VM is running
    self.libvirt.wait_for_running(vm_id).await?;
    
    // Get VM's port ID
    let port_id = self.get_vm_port(vm_id)?;
    
    // Notify control plane to switch port binding
    self.control_plane.notify_migration_complete(vm_id, port_id).await?;
    
    Ok(())
}
```

---

## Timing Considerations

### Critical Window

The time between VM pause on source and port switch must be minimized:

| Phase | Typical Duration | Impact |
|-------|------------------|--------|
| VM Pause | 50-200ms | VM unresponsive |
| Port Switch | 10-50ms | Network blackhole |
| Flow Update | 50-100ms | OVS reconfiguration |
| **Total** | **110-350ms** | **Max disruption** |

### Best Practices

1. **Pre-stage destination**: Set up shadow binding before migration
2. **Minimize memory delta**: Reduce dirty pages during transfer
3. **Fast SSD storage**: Reduces migration time
4. **Low-latency network**: Faster memory transfer

---

## Troubleshooting

### Check Port Binding Status

```bash
# Current binding
ovn-sbctl get Port_Binding vm-port-1 chassis

# Pending request
ovn-nbctl get Logical_Switch_Port vm-port-1 options:requested-chassis
```

### Network Blackhole During Migration

1. Check if binding switched correctly:
```bash
ovn-sbctl find Port_Binding logical_port=vm-port-1
```

2. Verify OVS flows updated:
```bash
# On destination node
ovs-ofctl dump-flows br-int | grep <vm-mac>
```

3. Check OVN controller logs:
```bash
journalctl -u ovn-controller -n 100
```

### Port Stuck in Wrong Chassis

Force rebind manually:

```bash
# Get correct chassis UUID
CHASSIS=$(ovn-sbctl find Chassis name=destination-node | grep _uuid | awk '{print $3}')

# Force port binding
ovn-sbctl set Port_Binding vm-port-1 chassis=$CHASSIS
```

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/migration.go` | Port binding service |
| `backend/internal/services/vm/migration.go` | VM migration integration |
| `agent/limiquantix-node/src/migration.rs` | Agent migration handler |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN architecture
- [000091-live-memory-snapshots.md](../Quantix-vDC/000091-live-memory-snapshots.md) - Live migration
