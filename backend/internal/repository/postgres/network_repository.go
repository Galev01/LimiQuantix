// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/network"
)

// Ensure NetworkRepository implements network.NetworkRepository
var _ network.NetworkRepository = (*NetworkRepository)(nil)

// NetworkRepository implements network.NetworkRepository using PostgreSQL.
type NetworkRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewNetworkRepository creates a new PostgreSQL Network repository.
func NewNetworkRepository(db *DB, logger *zap.Logger) *NetworkRepository {
	return &NetworkRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "network")),
	}
}

// Create stores a new virtual network.
func (r *NetworkRepository) Create(ctx context.Context, net *domain.VirtualNetwork) (*domain.VirtualNetwork, error) {
	if net.ID == "" {
		net.ID = uuid.New().String()
	}

	specJSON, err := json.Marshal(net.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(net.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	ipStatusJSON, err := json.Marshal(net.Status.IPAllocationStatus)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal ip_allocation_status: %w", err)
	}

	dnsServersJSON, err := json.Marshal(net.Spec.DNS.Nameservers)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal dns_servers: %w", err)
	}

	// Extract legacy fields from spec for backward compatibility
	networkType := string(net.Spec.Type)
	if networkType == "" {
		networkType = "OVERLAY"
	}

	var vlanID *int
	if net.Spec.VLAN != nil && net.Spec.VLAN.VLANID > 0 {
		v := int(net.Spec.VLAN.VLANID)
		vlanID = &v
	}

	query := `
		INSERT INTO virtual_networks (
			id, name, project_id, description, labels, spec,
			network_type, vlan_id, cidr, gateway, dhcp_enabled, dns_servers,
			phase, ovn_logical_switch, ovn_logical_router, port_count,
			ip_allocation_status, error_message
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::cidr, $10::inet, $11, $12, $13, $14, $15, $16, $17, $18)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		net.ID,
		net.Name,
		net.ProjectID,
		net.Description,
		labelsJSON,
		specJSON,
		networkType,
		vlanID,
		nullString(net.Spec.IPConfig.IPv4Subnet),
		nullString(net.Spec.IPConfig.IPv4Gateway),
		net.Spec.IPConfig.DHCP.Enabled,
		dnsServersJSON,
		string(net.Status.Phase),
		nullString(net.Status.OVNLogicalSwitch),
		nullString(net.Status.OVNLogicalRouter),
		net.Status.PortCount,
		ipStatusJSON,
		nullString(net.Status.ErrorMessage),
	).Scan(&net.CreatedAt, &net.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create network", zap.Error(err), zap.String("name", net.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert network: %w", err)
	}

	r.logger.Info("Created network", zap.String("id", net.ID), zap.String("name", net.Name))
	return net, nil
}

// Get retrieves a virtual network by ID.
func (r *NetworkRepository) Get(ctx context.Context, id string) (*domain.VirtualNetwork, error) {
	query := `
		SELECT id, name, project_id, description, labels, spec,
		       phase, ovn_logical_switch, ovn_logical_router, port_count,
		       ip_allocation_status, error_message, created_at, updated_at
		FROM virtual_networks
		WHERE id = $1
	`

	return r.scanNetwork(ctx, query, id)
}

// GetByName retrieves a network by name within a project.
func (r *NetworkRepository) GetByName(ctx context.Context, projectID, name string) (*domain.VirtualNetwork, error) {
	query := `
		SELECT id, name, project_id, description, labels, spec,
		       phase, ovn_logical_switch, ovn_logical_router, port_count,
		       ip_allocation_status, error_message, created_at, updated_at
		FROM virtual_networks
		WHERE project_id = $1 AND name = $2
	`

	return r.scanNetwork(ctx, query, projectID, name)
}

// List retrieves virtual networks based on filter criteria.
func (r *NetworkRepository) List(ctx context.Context, filter network.NetworkFilter, limit int, offset int) ([]*domain.VirtualNetwork, int, error) {
	// Build WHERE clause
	whereClause := "WHERE 1=1"
	args := []interface{}{}
	argNum := 1

	if filter.ProjectID != "" {
		whereClause += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		argNum++
	}

	if filter.NetworkType != "" {
		whereClause += fmt.Sprintf(" AND spec->>'type' = $%d", argNum)
		args = append(args, string(filter.NetworkType))
		argNum++
	}

	for key, value := range filter.Labels {
		whereClause += fmt.Sprintf(" AND labels->>$%d = $%d", argNum, argNum+1)
		args = append(args, key, value)
		argNum += 2
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM virtual_networks %s", whereClause)
	var total int
	err := r.db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count networks: %w", err)
	}

	// Get results
	query := fmt.Sprintf(`
		SELECT id, name, project_id, description, labels, spec,
		       phase, ovn_logical_switch, ovn_logical_router, port_count,
		       ip_allocation_status, error_message, created_at, updated_at
		FROM virtual_networks
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list networks: %w", err)
	}
	defer rows.Close()

	var networks []*domain.VirtualNetwork
	for rows.Next() {
		net, err := r.scanNetworkRow(rows)
		if err != nil {
			return nil, 0, err
		}
		networks = append(networks, net)
	}

	return networks, total, nil
}

// Update updates a virtual network.
func (r *NetworkRepository) Update(ctx context.Context, net *domain.VirtualNetwork) (*domain.VirtualNetwork, error) {
	specJSON, err := json.Marshal(net.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(net.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	ipStatusJSON, err := json.Marshal(net.Status.IPAllocationStatus)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal ip_allocation_status: %w", err)
	}

	dnsServersJSON, err := json.Marshal(net.Spec.DNS.Nameservers)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal dns_servers: %w", err)
	}

	// Extract legacy fields from spec for backward compatibility
	networkType := string(net.Spec.Type)
	if networkType == "" {
		networkType = "OVERLAY"
	}

	var vlanID *int
	if net.Spec.VLAN != nil && net.Spec.VLAN.VLANID > 0 {
		v := int(net.Spec.VLAN.VLANID)
		vlanID = &v
	}

	query := `
		UPDATE virtual_networks SET
			name = $2,
			description = $3,
			labels = $4,
			spec = $5,
			network_type = $6,
			vlan_id = $7,
			cidr = $8::cidr,
			gateway = $9::inet,
			dhcp_enabled = $10,
			dns_servers = $11,
			phase = $12,
			ovn_logical_switch = $13,
			ovn_logical_router = $14,
			port_count = $15,
			ip_allocation_status = $16,
			error_message = $17,
			updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		net.ID,
		net.Name,
		net.Description,
		labelsJSON,
		specJSON,
		networkType,
		vlanID,
		nullString(net.Spec.IPConfig.IPv4Subnet),
		nullString(net.Spec.IPConfig.IPv4Gateway),
		net.Spec.IPConfig.DHCP.Enabled,
		dnsServersJSON,
		string(net.Status.Phase),
		nullString(net.Status.OVNLogicalSwitch),
		nullString(net.Status.OVNLogicalRouter),
		net.Status.PortCount,
		ipStatusJSON,
		nullString(net.Status.ErrorMessage),
	).Scan(&net.UpdatedAt)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to update network: %w", err)
	}

	return net, nil
}

// Delete removes a virtual network.
func (r *NetworkRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM virtual_networks WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete network: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted network", zap.String("id", id))
	return nil
}

// UpdateStatus updates the status of a virtual network.
func (r *NetworkRepository) UpdateStatus(ctx context.Context, id string, status domain.VirtualNetworkStatus) error {
	ipStatusJSON, err := json.Marshal(status.IPAllocationStatus)
	if err != nil {
		return fmt.Errorf("failed to marshal ip_allocation_status: %w", err)
	}

	query := `
		UPDATE virtual_networks SET
			phase = $2,
			ovn_logical_switch = $3,
			ovn_logical_router = $4,
			port_count = $5,
			ip_allocation_status = $6,
			error_message = $7,
			updated_at = NOW()
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		id,
		string(status.Phase),
		nullString(status.OVNLogicalSwitch),
		nullString(status.OVNLogicalRouter),
		status.PortCount,
		ipStatusJSON,
		nullString(status.ErrorMessage),
	)

	if err != nil {
		return fmt.Errorf("failed to update network status: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// scanNetwork executes a query and scans a single network.
func (r *NetworkRepository) scanNetwork(ctx context.Context, query string, args ...interface{}) (*domain.VirtualNetwork, error) {
	row := r.db.pool.QueryRow(ctx, query, args...)
	net, err := r.scanNetworkRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return net, nil
}

// scanNetworkRow scans a network from a row.
func (r *NetworkRepository) scanNetworkRow(row pgx.Row) (*domain.VirtualNetwork, error) {
	var (
		net             domain.VirtualNetwork
		labelsJSON      []byte
		specJSON        []byte
		phase           string
		ovnSwitch       *string
		ovnRouter       *string
		ipStatusJSON    []byte
		errorMsg        *string
	)

	err := row.Scan(
		&net.ID,
		&net.Name,
		&net.ProjectID,
		&net.Description,
		&labelsJSON,
		&specJSON,
		&phase,
		&ovnSwitch,
		&ovnRouter,
		&net.Status.PortCount,
		&ipStatusJSON,
		&errorMsg,
		&net.CreatedAt,
		&net.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Unmarshal JSON fields
	if err := json.Unmarshal(labelsJSON, &net.Labels); err != nil {
		return nil, fmt.Errorf("failed to unmarshal labels: %w", err)
	}

	if err := json.Unmarshal(specJSON, &net.Spec); err != nil {
		return nil, fmt.Errorf("failed to unmarshal spec: %w", err)
	}

	if err := json.Unmarshal(ipStatusJSON, &net.Status.IPAllocationStatus); err != nil {
		return nil, fmt.Errorf("failed to unmarshal ip_allocation_status: %w", err)
	}

	// Set status fields
	net.Status.Phase = domain.NetworkPhase(phase)
	if ovnSwitch != nil {
		net.Status.OVNLogicalSwitch = *ovnSwitch
	}
	if ovnRouter != nil {
		net.Status.OVNLogicalRouter = *ovnRouter
	}
	if errorMsg != nil {
		net.Status.ErrorMessage = *errorMsg
	}

	return &net, nil
}

// =============================================================================
// SECURITY GROUP REPOSITORY
// =============================================================================

// Ensure SecurityGroupRepository implements network.SecurityGroupRepository
var _ network.SecurityGroupRepository = (*SecurityGroupRepository)(nil)

// SecurityGroupRepository implements network.SecurityGroupRepository using PostgreSQL.
type SecurityGroupRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewSecurityGroupRepository creates a new PostgreSQL SecurityGroup repository.
func NewSecurityGroupRepository(db *DB, logger *zap.Logger) *SecurityGroupRepository {
	return &SecurityGroupRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "security_group")),
	}
}

// Create stores a new security group.
func (r *SecurityGroupRepository) Create(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error) {
	if sg.ID == "" {
		sg.ID = uuid.New().String()
	}

	labelsJSON, err := json.Marshal(sg.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	rulesJSON, err := json.Marshal(sg.Rules)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal rules: %w", err)
	}

	// Resolve project ID - if "default" or empty, look up the default project UUID
	var projectID interface{}
	if sg.ProjectID == "" || sg.ProjectID == "default" {
		// Use the well-known default project UUID
		projectID = "00000000-0000-0000-0000-000000000001"
		sg.ProjectID = "00000000-0000-0000-0000-000000000001"
	} else {
		// Try to parse as UUID, if not valid, look up by name
		if _, err := uuid.Parse(sg.ProjectID); err != nil {
			// Look up project by name
			var projectUUID string
			err := r.db.pool.QueryRow(ctx, "SELECT id FROM projects WHERE name = $1", sg.ProjectID).Scan(&projectUUID)
			if err != nil {
				// If project not found, use default
				projectID = "00000000-0000-0000-0000-000000000001"
				sg.ProjectID = "00000000-0000-0000-0000-000000000001"
			} else {
				projectID = projectUUID
				sg.ProjectID = projectUUID
			}
		} else {
			projectID = sg.ProjectID
		}
	}

	query := `
		INSERT INTO security_groups (id, name, project_id, description, labels, stateful, rules)
		VALUES ($1, $2, $3::uuid, $4, $5, $6, $7)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		sg.ID,
		sg.Name,
		projectID,
		sg.Description,
		labelsJSON,
		sg.Stateful,
		rulesJSON,
	).Scan(&sg.CreatedAt, &sg.UpdatedAt)

	if err != nil {
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert security group: %w", err)
	}

	return sg, nil
}

// Get retrieves a security group by ID.
func (r *SecurityGroupRepository) Get(ctx context.Context, id string) (*domain.SecurityGroup, error) {
	query := `
		SELECT id, name, project_id, description, labels, stateful, rules, created_at, updated_at
		FROM security_groups
		WHERE id = $1
	`

	var (
		sg         domain.SecurityGroup
		labelsJSON []byte
		rulesJSON  []byte
	)

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&sg.ID,
		&sg.Name,
		&sg.ProjectID,
		&sg.Description,
		&labelsJSON,
		&sg.Stateful,
		&rulesJSON,
		&sg.CreatedAt,
		&sg.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get security group: %w", err)
	}

	if err := json.Unmarshal(labelsJSON, &sg.Labels); err != nil {
		return nil, fmt.Errorf("failed to unmarshal labels: %w", err)
	}

	if err := json.Unmarshal(rulesJSON, &sg.Rules); err != nil {
		return nil, fmt.Errorf("failed to unmarshal rules: %w", err)
	}

	return &sg, nil
}

// GetByName retrieves a security group by name within a project.
func (r *SecurityGroupRepository) GetByName(ctx context.Context, projectID, name string) (*domain.SecurityGroup, error) {
	query := `
		SELECT id, name, project_id, description, labels, stateful, rules, created_at, updated_at
		FROM security_groups
		WHERE project_id = $1 AND name = $2
	`

	var (
		sg         domain.SecurityGroup
		labelsJSON []byte
		rulesJSON  []byte
	)

	err := r.db.pool.QueryRow(ctx, query, projectID, name).Scan(
		&sg.ID,
		&sg.Name,
		&sg.ProjectID,
		&sg.Description,
		&labelsJSON,
		&sg.Stateful,
		&rulesJSON,
		&sg.CreatedAt,
		&sg.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get security group by name: %w", err)
	}

	if err := json.Unmarshal(labelsJSON, &sg.Labels); err != nil {
		return nil, fmt.Errorf("failed to unmarshal labels: %w", err)
	}

	if err := json.Unmarshal(rulesJSON, &sg.Rules); err != nil {
		return nil, fmt.Errorf("failed to unmarshal rules: %w", err)
	}

	return &sg, nil
}

// List retrieves security groups based on filter criteria.
func (r *SecurityGroupRepository) List(ctx context.Context, projectID string, limit int, offset int) ([]*domain.SecurityGroup, int, error) {
	// Build WHERE clause
	whereClause := "WHERE 1=1"
	args := []interface{}{}
	argNum := 1

	if projectID != "" {
		whereClause += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, projectID)
		argNum++
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM security_groups %s", whereClause)
	var total int
	err := r.db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count security groups: %w", err)
	}

	// Get results
	query := fmt.Sprintf(`
		SELECT id, name, project_id, description, labels, stateful, rules, created_at, updated_at
		FROM security_groups
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list security groups: %w", err)
	}
	defer rows.Close()

	var groups []*domain.SecurityGroup
	for rows.Next() {
		var (
			sg         domain.SecurityGroup
			labelsJSON []byte
			rulesJSON  []byte
		)

		err := rows.Scan(
			&sg.ID,
			&sg.Name,
			&sg.ProjectID,
			&sg.Description,
			&labelsJSON,
			&sg.Stateful,
			&rulesJSON,
			&sg.CreatedAt,
			&sg.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}

		if err := json.Unmarshal(labelsJSON, &sg.Labels); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal(rulesJSON, &sg.Rules); err != nil {
			return nil, 0, err
		}

		groups = append(groups, &sg)
	}

	return groups, total, nil
}

// Update updates a security group.
func (r *SecurityGroupRepository) Update(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error) {
	labelsJSON, err := json.Marshal(sg.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	rulesJSON, err := json.Marshal(sg.Rules)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal rules: %w", err)
	}

	query := `
		UPDATE security_groups SET
			name = $2,
			description = $3,
			labels = $4,
			stateful = $5,
			rules = $6,
			updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		sg.ID,
		sg.Name,
		sg.Description,
		labelsJSON,
		sg.Stateful,
		rulesJSON,
	).Scan(&sg.UpdatedAt)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to update security group: %w", err)
	}

	return sg, nil
}

// Delete removes a security group.
func (r *SecurityGroupRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM security_groups WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete security group: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}
