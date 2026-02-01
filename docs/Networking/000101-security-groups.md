# Security Groups - Network Access Control

**Document:** 000101-security-groups  
**Category:** Networking / Security  
**Status:** Implemented  
**Last Updated:** January 2026

---

## Overview

Security Groups provide stateful firewall rules for controlling network traffic to and from VMs. They act as virtual firewalls at the port level, filtering traffic based on protocol, port, and source/destination.

**Key Features:**
- Stateful firewall rules (return traffic automatically allowed)
- Per-VM or per-network assignment
- Ingress (inbound) and egress (outbound) rules
- Protocol-based filtering (TCP, UDP, ICMP, Any)
- CIDR-based source/destination filtering
- OVN-backed implementation for high performance

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Security Groups Flow                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────┐ │
│  │ Frontend │───▶│ Backend API  │───▶│ PostgreSQL  │    │  OVN   │ │
│  │  (React) │    │    (Go)      │    │  Database   │    │ ACLs   │ │
│  └──────────┘    └──────────────┘    └─────────────┘    └────────┘ │
│       │                │                    │                │      │
│       │                │                    │                │      │
│       ▼                ▼                    ▼                ▼      │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────┐ │
│  │ Create   │    │ Store Rules  │    │ Persist     │    │ Apply  │ │
│  │ SG/Rules │    │ to Domain    │    │ Security    │    │ to     │ │
│  │ Modal    │    │ Model        │    │ Groups      │    │ Ports  │ │
│  └──────────┘    └──────────────┘    └─────────────┘    └────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Domain Model (`backend/internal/domain/network.go`)

```go
// SecurityGroup defines firewall rules for network ports.
type SecurityGroup struct {
    ID          string            `json:"id"`
    Name        string            `json:"name"`
    Description string            `json:"description"`
    ProjectID   string            `json:"project_id"`
    Labels      map[string]string `json:"labels"`
    Rules       []SecurityGroupRule `json:"rules"`
    Stateful    bool              `json:"stateful"`
    CreatedAt   time.Time         `json:"created_at"`
    UpdatedAt   time.Time         `json:"updated_at"`
}

// SecurityGroupRule represents a single firewall rule.
type SecurityGroupRule struct {
    ID                    string        `json:"id"`
    Direction             RuleDirection `json:"direction"`     // INGRESS or EGRESS
    Protocol              string        `json:"protocol"`      // tcp, udp, icmp, any
    PortMin               uint32        `json:"port_min"`
    PortMax               uint32        `json:"port_max"`
    ICMPType              int32         `json:"icmp_type"`
    ICMPCode              int32         `json:"icmp_code"`
    RemoteIPPrefix        string        `json:"remote_ip_prefix"`
    RemoteSecurityGroupID string        `json:"remote_security_group_id"`
    Action                RuleAction    `json:"action"`        // ALLOW, DROP, REJECT
    Priority              uint32        `json:"priority"`
    Description           string        `json:"description"`
}
```

### Database Schema (`backend/migrations/000013_networks.up.sql`)

```sql
CREATE TABLE IF NOT EXISTS security_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    stateful BOOLEAN DEFAULT TRUE,
    rules JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_security_groups_project ON security_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_security_groups_labels ON security_groups USING GIN(labels);
```

---

## Backend Implementation

### Repository Interface (`backend/internal/services/network/network_repository.go`)

```go
type SecurityGroupRepository interface {
    Create(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error)
    Get(ctx context.Context, id string) (*domain.SecurityGroup, error)
    GetByName(ctx context.Context, projectID, name string) (*domain.SecurityGroup, error)
    List(ctx context.Context, projectID string, limit int, offset int) ([]*domain.SecurityGroup, int, error)
    Update(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error)
    Delete(ctx context.Context, id string) error
}
```

### PostgreSQL Repository (`backend/internal/repository/postgres/network_repository.go`)

The `SecurityGroupRepository` implements persistent storage using PostgreSQL with:
- JSONB storage for flexible rule definitions
- Automatic timestamps via database triggers
- Unique constraint on (project_id, name)

### gRPC Service (`backend/internal/services/network/security_group_service.go`)

```go
// CreateSecurityGroup creates a new security group
func (s *SecurityGroupService) CreateSecurityGroup(
    ctx context.Context,
    req *connect.Request[networkv1.CreateSecurityGroupRequest],
) (*connect.Response[networkv1.SecurityGroup], error)

// ListSecurityGroups lists all security groups
func (s *SecurityGroupService) ListSecurityGroups(
    ctx context.Context,
    req *connect.Request[networkv1.ListSecurityGroupsRequest],
) (*connect.Response[networkv1.ListSecurityGroupsResponse], error)

// AddSecurityGroupRule adds a rule to a security group
func (s *SecurityGroupService) AddSecurityGroupRule(
    ctx context.Context,
    req *connect.Request[networkv1.AddSecurityGroupRuleRequest],
) (*connect.Response[networkv1.SecurityGroup], error)

// RemoveSecurityGroupRule removes a rule from a security group
func (s *SecurityGroupService) RemoveSecurityGroupRule(
    ctx context.Context,
    req *connect.Request[networkv1.RemoveSecurityGroupRuleRequest],
) (*connect.Response[networkv1.SecurityGroup], error)

// DeleteSecurityGroup deletes a security group
func (s *SecurityGroupService) DeleteSecurityGroup(
    ctx context.Context,
    req *connect.Request[networkv1.DeleteSecurityGroupRequest],
) (*connect.Response[emptypb.Empty], error)
```

---

## Frontend Implementation

### React Query Hooks (`frontend/src/hooks/useSecurityGroups.ts`)

```typescript
// List all security groups
export function useSecurityGroups(options?: { projectId?: string; enabled?: boolean });

// Get a single security group
export function useSecurityGroup(id: string, enabled?: boolean);

// Create a new security group
export function useCreateSecurityGroup();

// Add a rule to a security group
export function useAddSecurityGroupRule();

// Remove a rule from a security group
export function useRemoveSecurityGroupRule();

// Delete a security group
export function useDeleteSecurityGroup();
```

### Page Component (`frontend/src/pages/SecurityGroups.tsx`)

The Security Groups page provides:

1. **Summary Cards** - Total groups, rules, and protected VMs
2. **Search** - Filter security groups by name/description
3. **Expandable Cards** - View rules for each security group
4. **Create Modal** - Create new security groups
5. **Add Rule Modal** - Add ingress/egress rules with:
   - Protocol selection (TCP, UDP, ICMP, Any)
   - Port range configuration
   - Source/Destination CIDR
6. **Delete Confirmation** - Safe deletion with confirmation

### Key UI Components

```tsx
// Main page component
export function SecurityGroups()

// Individual security group card with expandable rules
function SecurityGroupCard({ group, onDelete, onAddRule })

// Rules table showing all rules in a security group
function RulesTable({ rules })

// Modal for creating new security groups
function CreateSecurityGroupModal({ open, onClose, onSubmit })

// Modal for adding rules
function AddRuleModal({ open, direction, onClose, onSubmit })
```

---

## API Reference

### Proto Definitions (`proto/limiquantix/network/v1/network_service.proto`)

```protobuf
service SecurityGroupService {
  rpc CreateSecurityGroup(CreateSecurityGroupRequest) returns (SecurityGroup);
  rpc GetSecurityGroup(GetSecurityGroupRequest) returns (SecurityGroup);
  rpc ListSecurityGroups(ListSecurityGroupsRequest) returns (ListSecurityGroupsResponse);
  rpc UpdateSecurityGroup(UpdateSecurityGroupRequest) returns (SecurityGroup);
  rpc DeleteSecurityGroup(DeleteSecurityGroupRequest) returns (google.protobuf.Empty);
  rpc AddSecurityGroupRule(AddSecurityGroupRuleRequest) returns (SecurityGroup);
  rpc RemoveSecurityGroupRule(RemoveSecurityGroupRuleRequest) returns (SecurityGroup);
}
```

### REST Endpoints (via Connect-RPC)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/limiquantix.network.v1.SecurityGroupService/CreateSecurityGroup` | Create security group |
| POST | `/limiquantix.network.v1.SecurityGroupService/ListSecurityGroups` | List security groups |
| POST | `/limiquantix.network.v1.SecurityGroupService/GetSecurityGroup` | Get security group by ID |
| POST | `/limiquantix.network.v1.SecurityGroupService/DeleteSecurityGroup` | Delete security group |
| POST | `/limiquantix.network.v1.SecurityGroupService/AddSecurityGroupRule` | Add rule to security group |
| POST | `/limiquantix.network.v1.SecurityGroupService/RemoveSecurityGroupRule` | Remove rule from security group |

---

## Usage Examples

### Creating a Web Server Security Group

```bash
# Via curl
curl -X POST https://192.168.0.100/limiquantix.network.v1.SecurityGroupService/CreateSecurityGroup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web-servers",
    "projectId": "default",
    "description": "Allow HTTP/HTTPS traffic"
  }'
```

### Adding Rules

```bash
# Allow HTTP (port 80)
curl -X POST https://192.168.0.100/limiquantix.network.v1.SecurityGroupService/AddSecurityGroupRule \
  -H "Content-Type: application/json" \
  -d '{
    "securityGroupId": "sg-xxx",
    "rule": {
      "direction": "INGRESS",
      "protocol": "tcp",
      "portRangeMin": 80,
      "portRangeMax": 80,
      "remoteIpPrefix": "0.0.0.0/0"
    }
  }'

# Allow HTTPS (port 443)
curl -X POST https://192.168.0.100/limiquantix.network.v1.SecurityGroupService/AddSecurityGroupRule \
  -H "Content-Type: application/json" \
  -d '{
    "securityGroupId": "sg-xxx",
    "rule": {
      "direction": "INGRESS",
      "protocol": "tcp",
      "portRangeMin": 443,
      "portRangeMax": 443,
      "remoteIpPrefix": "0.0.0.0/0"
    }
  }'

# Allow SSH from specific subnet
curl -X POST https://192.168.0.100/limiquantix.network.v1.SecurityGroupService/AddSecurityGroupRule \
  -H "Content-Type: application/json" \
  -d '{
    "securityGroupId": "sg-xxx",
    "rule": {
      "direction": "INGRESS",
      "protocol": "tcp",
      "portRangeMin": 22,
      "portRangeMax": 22,
      "remoteIpPrefix": "10.0.0.0/8"
    }
  }'
```

---

## Common Security Group Patterns

### 1. Web Server

| Direction | Protocol | Port | Source | Description |
|-----------|----------|------|--------|-------------|
| INGRESS | TCP | 80 | 0.0.0.0/0 | HTTP |
| INGRESS | TCP | 443 | 0.0.0.0/0 | HTTPS |
| INGRESS | TCP | 22 | 10.0.0.0/8 | SSH (internal only) |
| EGRESS | ANY | ALL | 0.0.0.0/0 | Allow all outbound |

### 2. Database Server

| Direction | Protocol | Port | Source | Description |
|-----------|----------|------|--------|-------------|
| INGRESS | TCP | 5432 | 10.100.0.0/24 | PostgreSQL from app subnet |
| INGRESS | TCP | 3306 | 10.100.0.0/24 | MySQL from app subnet |
| INGRESS | TCP | 22 | 10.0.0.0/8 | SSH (internal only) |
| EGRESS | TCP | 443 | 0.0.0.0/0 | Updates/backups |

### 3. Internal Services

| Direction | Protocol | Port | Source | Description |
|-----------|----------|------|--------|-------------|
| INGRESS | TCP | 8080 | 10.0.0.0/8 | Internal API |
| INGRESS | TCP | 22 | 10.0.0.0/8 | SSH |
| EGRESS | ANY | ALL | 10.0.0.0/8 | Internal communication |

---

## OVN Integration (Future)

When VMs are attached to security groups, the rules will be translated to OVN ACLs:

```bash
# OVN ACL for allowing HTTP
ovn-nbctl acl-add <switch> to-lport 1000 \
  'outport == "<port>" && tcp.dst == 80' allow

# OVN ACL for blocking all other traffic
ovn-nbctl acl-add <switch> to-lport 0 \
  'outport == "<port>"' drop
```

---

## File Locations

| Component | Path |
|-----------|------|
| Domain Model | `backend/internal/domain/network.go` |
| Repository Interface | `backend/internal/services/network/network_repository.go` |
| PostgreSQL Repository | `backend/internal/repository/postgres/network_repository.go` |
| gRPC Service | `backend/internal/services/network/security_group_service.go` |
| Proto Definition | `proto/limiquantix/network/v1/network_service.proto` |
| React Hooks | `frontend/src/hooks/useSecurityGroups.ts` |
| Page Component | `frontend/src/pages/SecurityGroups.tsx` |
| Database Migration | `backend/migrations/000013_networks.up.sql` |

---

## Troubleshooting

### Security Group Not Showing

1. Check database connection:
   ```bash
   psql -U postgres -d quantix_vdc -c "SELECT * FROM security_groups;"
   ```

2. Check control plane logs:
   ```bash
   journalctl -u quantix-controlplane -n 50 --no-pager | grep -i security
   ```

### Rules Not Being Applied

1. Verify security group is attached to VM/port
2. Check OVN ACL status (when implemented):
   ```bash
   ovn-nbctl acl-list <logical-switch>
   ```

### API Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `already exists` | Duplicate name | Use unique name |
| `not found` | Invalid ID | Verify security group exists |
| `invalid_argument` | Missing required field | Check request payload |

---

## Related Documentation

- [000048 - Network Backend OVN/OVS](./000048-network-backend-ovn-ovs.md)
- [000098 - Networking Index](./000098-networking-index.md)
- [000100 - Home Lab Network Setup Guide](./000100-homelab-network-setup-guide.md)
