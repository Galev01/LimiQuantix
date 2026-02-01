# VM Creation Wizard - Security Group Selection

## Status: COMPLETED ✓

## Goal
Add security group selection to the VM creation wizard so users can assign security groups to NICs during VM creation.

## Changes Made

### 1. Frontend - VMCreationWizard.tsx

**Interface Updates:**
- Added `securityGroupIds: string[]` to `NetworkInterface` interface
- Updated initial form data to include empty `securityGroupIds` array

**Hook Integration:**
- Added `useSecurityGroups` hook import
- Added `securityGroupsData` and `securityGroupsLoading` state
- Created `securityGroups` memoized array from API data

**StepHardware Component:**
- Added `securityGroups` prop to function signature
- Updated `addNIC` to include default security group
- Redesigned NIC row UI with 2-column grid layout:
  - Network dropdown (left)
  - Security Group dropdown (right)
- Added ShieldCheck icon for security group label

**VM Creation Submission:**
- Updated NIC mapping to include `securityGroups: nic.securityGroupIds`

**Review Section:**
- Updated to show security groups for each NIC

### 2. Frontend - api-client.ts

**ApiVM Interface:**
- Added `securityGroups?: string[]` to NIC spec interface

### 3. Backend Verification

The backend already supports security groups:

**Proto (vm.proto):**
```protobuf
message NetworkInterface {
  // ...
  repeated string security_groups = 5;
  // ...
}
```

**Domain (vm.go):**
```go
type NetworkDevice struct {
    // ...
    SecurityGroups  []string `json:"security_groups,omitempty"`
    // ...
}
```

**Converter (converter.go):**
- Already maps `SecurityGroups` from proto to domain and vice versa

**Network Port Configuration:**
- `ConfigureNetworkPortRequest` has `security_group_ids` field
- Security groups are applied at the OVN/OVS level when port is configured

## UI Layout

The NIC configuration in the Hardware step now shows:

```
┌─────────────────────────────────────────────────────────────┐
│ NIC 1                                    [✓] Connected  [🗑] │
├─────────────────────────────────────────────────────────────┤
│ Network                    │ 🛡 Security Group              │
│ ┌─────────────────────┐   │ ┌─────────────────────┐        │
│ │ vm-network (overlay)│   │ │ default             │        │
│ └─────────────────────┘   │ └─────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

```
Frontend (VMCreationWizard)
    ↓ securityGroups: ['sg-123']
API Request (vmApi.create)
    ↓ spec.nics[].securityGroups
Backend (vm/service.go)
    ↓ domain.NetworkDevice.SecurityGroups
Database (stored in VM spec)
    ↓
VM Start → Network Port Configuration
    ↓ ConfigureNetworkPortRequest.security_group_ids
OVN/OVS ACL Rules Applied
```

## Testing

1. Open VM Creation Wizard
2. Go to Hardware step (step 5)
3. Each NIC should show:
   - Network dropdown
   - Security Group dropdown (with "No security group" option)
4. Select a security group
5. Complete wizard and create VM
6. Verify security group is stored in VM spec

## Log
- **2026-01-31**: Added useSecurityGroups hook import
- **2026-01-31**: Updated NetworkInterface interface with securityGroupIds
- **2026-01-31**: Added security groups fetch and processing
- **2026-01-31**: Updated StepHardware with security group dropdown
- **2026-01-31**: Updated VM creation submission to include security groups
- **2026-01-31**: Updated Review section to show security groups
- **2026-01-31**: Verified backend already handles security groups
