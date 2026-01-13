// Package network implements the IPAM repository for PostgreSQL persistence.
package network

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"time"

	"go.uber.org/zap"
)

// =============================================================================
// TYPES
// =============================================================================

// IPAllocationType represents the type of IP allocation.
type IPAllocationType string

const (
	AllocationTypeGateway   IPAllocationType = "gateway"
	AllocationTypeBroadcast IPAllocationType = "broadcast"
	AllocationTypeReserved  IPAllocationType = "reserved"
	AllocationTypeStatic    IPAllocationType = "static"
	AllocationTypeDynamic   IPAllocationType = "dynamic"
)

// SubnetPool represents a subnet pool in the database.
type SubnetPool struct {
	ID              string    `db:"id"`
	NetworkID       string    `db:"network_id"`
	CIDR            string    `db:"cidr"`
	Gateway         string    `db:"gateway"`
	AllocStart      string    `db:"alloc_start"`
	AllocEnd        string    `db:"alloc_end"`
	TotalIPs        int       `db:"total_ips"`
	AllocatedIPs    int       `db:"allocated_ips"`
	DHCPEnabled     bool      `db:"dhcp_enabled"`
	DHCPOptionsUUID *string   `db:"dhcp_options_uuid"`
	DNSServers      []string  `db:"dns_servers"`
	NTPServers      []string  `db:"ntp_servers"`
	DomainName      *string   `db:"domain_name"`
	LeaseTimeSec    int       `db:"lease_time_sec"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

// IPAllocation represents an IP allocation in the database.
type IPAllocation struct {
	ID             string           `db:"id"`
	NetworkID      string           `db:"network_id"`
	PoolID         string           `db:"pool_id"`
	PortID         *string          `db:"port_id"`
	IPAddress      string           `db:"ip_address"`
	MACAddress     *string          `db:"mac_address"`
	Hostname       *string          `db:"hostname"`
	AllocationType IPAllocationType `db:"allocation_type"`
	Description    *string          `db:"description"`
	ExpiresAt      *time.Time       `db:"expires_at"`
	CreatedAt      time.Time        `db:"created_at"`
	UpdatedAt      time.Time        `db:"updated_at"`
}

// MACRegistry represents a MAC address registration.
type MACRegistry struct {
	ID         string    `db:"id"`
	MACAddress string    `db:"mac_address"`
	PortID     *string   `db:"port_id"`
	VMID       *string   `db:"vm_id"`
	ProjectID  *string   `db:"project_id"`
	CreatedAt  time.Time `db:"created_at"`
}

// DHCPStaticBinding represents a static DHCP binding.
type DHCPStaticBinding struct {
	ID          string    `db:"id"`
	NetworkID   string    `db:"network_id"`
	PoolID      string    `db:"pool_id"`
	MACAddress  string    `db:"mac_address"`
	IPAddress   string    `db:"ip_address"`
	Hostname    *string   `db:"hostname"`
	Description *string   `db:"description"`
	Enabled     bool      `db:"enabled"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

// =============================================================================
// REPOSITORY
// =============================================================================

// IPAMRepository provides database operations for IPAM.
type IPAMRepository struct {
	db     *sql.DB
	logger *zap.Logger
}

// NewIPAMRepository creates a new IPAM repository.
func NewIPAMRepository(db *sql.DB, logger *zap.Logger) *IPAMRepository {
	return &IPAMRepository{
		db:     db,
		logger: logger.Named("ipam-repo"),
	}
}

// =============================================================================
// SUBNET POOL OPERATIONS
// =============================================================================

// CreatePool creates a new subnet pool.
func (r *IPAMRepository) CreatePool(ctx context.Context, pool *SubnetPool) error {
	query := `
		INSERT INTO subnet_pools (
			id, network_id, cidr, gateway, alloc_start, alloc_end,
			total_ips, allocated_ips, dhcp_enabled, dhcp_options_uuid,
			dns_servers, ntp_servers, domain_name, lease_time_sec
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`

	_, err := r.db.ExecContext(ctx, query,
		pool.ID, pool.NetworkID, pool.CIDR, pool.Gateway,
		pool.AllocStart, pool.AllocEnd, pool.TotalIPs, pool.AllocatedIPs,
		pool.DHCPEnabled, pool.DHCPOptionsUUID,
		pool.DNSServers, pool.NTPServers, pool.DomainName, pool.LeaseTimeSec,
	)

	if err != nil {
		r.logger.Error("Failed to create subnet pool",
			zap.String("network_id", pool.NetworkID),
			zap.Error(err),
		)
		return fmt.Errorf("failed to create subnet pool: %w", err)
	}

	r.logger.Info("Created subnet pool",
		zap.String("pool_id", pool.ID),
		zap.String("network_id", pool.NetworkID),
		zap.String("cidr", pool.CIDR),
	)

	return nil
}

// GetPoolByNetworkID retrieves a subnet pool by network ID.
func (r *IPAMRepository) GetPoolByNetworkID(ctx context.Context, networkID string) (*SubnetPool, error) {
	query := `
		SELECT id, network_id, cidr, gateway, alloc_start, alloc_end,
			   total_ips, allocated_ips, dhcp_enabled, dhcp_options_uuid,
			   dns_servers, ntp_servers, domain_name, lease_time_sec,
			   created_at, updated_at
		FROM subnet_pools
		WHERE network_id = $1
	`

	pool := &SubnetPool{}
	err := r.db.QueryRowContext(ctx, query, networkID).Scan(
		&pool.ID, &pool.NetworkID, &pool.CIDR, &pool.Gateway,
		&pool.AllocStart, &pool.AllocEnd, &pool.TotalIPs, &pool.AllocatedIPs,
		&pool.DHCPEnabled, &pool.DHCPOptionsUUID,
		&pool.DNSServers, &pool.NTPServers, &pool.DomainName, &pool.LeaseTimeSec,
		&pool.CreatedAt, &pool.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get subnet pool: %w", err)
	}

	return pool, nil
}

// GetPool retrieves a subnet pool by ID.
func (r *IPAMRepository) GetPool(ctx context.Context, poolID string) (*SubnetPool, error) {
	query := `
		SELECT id, network_id, cidr, gateway, alloc_start, alloc_end,
			   total_ips, allocated_ips, dhcp_enabled, dhcp_options_uuid,
			   dns_servers, ntp_servers, domain_name, lease_time_sec,
			   created_at, updated_at
		FROM subnet_pools
		WHERE id = $1
	`

	pool := &SubnetPool{}
	err := r.db.QueryRowContext(ctx, query, poolID).Scan(
		&pool.ID, &pool.NetworkID, &pool.CIDR, &pool.Gateway,
		&pool.AllocStart, &pool.AllocEnd, &pool.TotalIPs, &pool.AllocatedIPs,
		&pool.DHCPEnabled, &pool.DHCPOptionsUUID,
		&pool.DNSServers, &pool.NTPServers, &pool.DomainName, &pool.LeaseTimeSec,
		&pool.CreatedAt, &pool.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get subnet pool: %w", err)
	}

	return pool, nil
}

// UpdatePoolDHCPOptions updates the DHCP options UUID for a pool.
func (r *IPAMRepository) UpdatePoolDHCPOptions(ctx context.Context, poolID, dhcpOptionsUUID string) error {
	query := `UPDATE subnet_pools SET dhcp_options_uuid = $1, updated_at = NOW() WHERE id = $2`
	_, err := r.db.ExecContext(ctx, query, dhcpOptionsUUID, poolID)
	return err
}

// DeletePool deletes a subnet pool.
func (r *IPAMRepository) DeletePool(ctx context.Context, networkID string) error {
	query := `DELETE FROM subnet_pools WHERE network_id = $1`
	_, err := r.db.ExecContext(ctx, query, networkID)
	if err != nil {
		return fmt.Errorf("failed to delete subnet pool: %w", err)
	}
	return nil
}

// =============================================================================
// IP ALLOCATION OPERATIONS
// =============================================================================

// AllocateIP allocates a new IP address.
func (r *IPAMRepository) AllocateIP(ctx context.Context, alloc *IPAllocation) error {
	query := `
		INSERT INTO ip_allocations (
			id, network_id, pool_id, port_id, ip_address, mac_address,
			hostname, allocation_type, description, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`

	_, err := r.db.ExecContext(ctx, query,
		alloc.ID, alloc.NetworkID, alloc.PoolID, alloc.PortID,
		alloc.IPAddress, alloc.MACAddress, alloc.Hostname,
		alloc.AllocationType, alloc.Description, alloc.ExpiresAt,
	)

	if err != nil {
		r.logger.Error("Failed to allocate IP",
			zap.String("network_id", alloc.NetworkID),
			zap.String("ip_address", alloc.IPAddress),
			zap.Error(err),
		)
		return fmt.Errorf("failed to allocate IP: %w", err)
	}

	r.logger.Info("Allocated IP",
		zap.String("allocation_id", alloc.ID),
		zap.String("ip_address", alloc.IPAddress),
		zap.String("allocation_type", string(alloc.AllocationType)),
	)

	return nil
}

// GetAllocation retrieves an IP allocation by network and IP.
func (r *IPAMRepository) GetAllocation(ctx context.Context, networkID, ipAddress string) (*IPAllocation, error) {
	query := `
		SELECT id, network_id, pool_id, port_id, ip_address, mac_address,
			   hostname, allocation_type, description, expires_at,
			   created_at, updated_at
		FROM ip_allocations
		WHERE network_id = $1 AND ip_address = $2
	`

	alloc := &IPAllocation{}
	err := r.db.QueryRowContext(ctx, query, networkID, ipAddress).Scan(
		&alloc.ID, &alloc.NetworkID, &alloc.PoolID, &alloc.PortID,
		&alloc.IPAddress, &alloc.MACAddress, &alloc.Hostname,
		&alloc.AllocationType, &alloc.Description, &alloc.ExpiresAt,
		&alloc.CreatedAt, &alloc.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get IP allocation: %w", err)
	}

	return alloc, nil
}

// GetAllocationByPort retrieves IP allocations for a port.
func (r *IPAMRepository) GetAllocationByPort(ctx context.Context, portID string) ([]*IPAllocation, error) {
	query := `
		SELECT id, network_id, pool_id, port_id, ip_address, mac_address,
			   hostname, allocation_type, description, expires_at,
			   created_at, updated_at
		FROM ip_allocations
		WHERE port_id = $1
	`

	rows, err := r.db.QueryContext(ctx, query, portID)
	if err != nil {
		return nil, fmt.Errorf("failed to query IP allocations: %w", err)
	}
	defer rows.Close()

	var allocations []*IPAllocation
	for rows.Next() {
		alloc := &IPAllocation{}
		err := rows.Scan(
			&alloc.ID, &alloc.NetworkID, &alloc.PoolID, &alloc.PortID,
			&alloc.IPAddress, &alloc.MACAddress, &alloc.Hostname,
			&alloc.AllocationType, &alloc.Description, &alloc.ExpiresAt,
			&alloc.CreatedAt, &alloc.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan IP allocation: %w", err)
		}
		allocations = append(allocations, alloc)
	}

	return allocations, nil
}

// ListAllocations lists all IP allocations for a network.
func (r *IPAMRepository) ListAllocations(ctx context.Context, networkID string) ([]*IPAllocation, error) {
	query := `
		SELECT id, network_id, pool_id, port_id, ip_address, mac_address,
			   hostname, allocation_type, description, expires_at,
			   created_at, updated_at
		FROM ip_allocations
		WHERE network_id = $1
		ORDER BY ip_address
	`

	rows, err := r.db.QueryContext(ctx, query, networkID)
	if err != nil {
		return nil, fmt.Errorf("failed to list IP allocations: %w", err)
	}
	defer rows.Close()

	var allocations []*IPAllocation
	for rows.Next() {
		alloc := &IPAllocation{}
		err := rows.Scan(
			&alloc.ID, &alloc.NetworkID, &alloc.PoolID, &alloc.PortID,
			&alloc.IPAddress, &alloc.MACAddress, &alloc.Hostname,
			&alloc.AllocationType, &alloc.Description, &alloc.ExpiresAt,
			&alloc.CreatedAt, &alloc.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan IP allocation: %w", err)
		}
		allocations = append(allocations, alloc)
	}

	return allocations, nil
}

// ReleaseIP releases an IP allocation.
func (r *IPAMRepository) ReleaseIP(ctx context.Context, networkID, ipAddress string) error {
	query := `DELETE FROM ip_allocations WHERE network_id = $1 AND ip_address = $2`
	result, err := r.db.ExecContext(ctx, query, networkID, ipAddress)
	if err != nil {
		return fmt.Errorf("failed to release IP: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	r.logger.Info("Released IP",
		zap.String("network_id", networkID),
		zap.String("ip_address", ipAddress),
		zap.Int64("rows_affected", rowsAffected),
	)

	return nil
}

// ReleaseIPByPort releases all IP allocations for a port.
func (r *IPAMRepository) ReleaseIPByPort(ctx context.Context, portID string) error {
	query := `DELETE FROM ip_allocations WHERE port_id = $1`
	result, err := r.db.ExecContext(ctx, query, portID)
	if err != nil {
		return fmt.Errorf("failed to release IPs by port: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	r.logger.Info("Released IPs by port",
		zap.String("port_id", portID),
		zap.Int64("rows_affected", rowsAffected),
	)

	return nil
}

// FindNextAvailableIP finds the next available IP in a pool.
func (r *IPAMRepository) FindNextAvailableIP(ctx context.Context, poolID string) (string, error) {
	query := `SELECT find_next_available_ip($1)`

	var ip sql.NullString
	err := r.db.QueryRowContext(ctx, query, poolID).Scan(&ip)
	if err != nil {
		return "", fmt.Errorf("failed to find next available IP: %w", err)
	}

	if !ip.Valid {
		return "", fmt.Errorf("no available IPs in pool")
	}

	return ip.String, nil
}

// IsIPAvailable checks if an IP is available in a network.
func (r *IPAMRepository) IsIPAvailable(ctx context.Context, networkID, ipAddress string) (bool, error) {
	query := `SELECT COUNT(*) FROM ip_allocations WHERE network_id = $1 AND ip_address = $2`

	var count int
	err := r.db.QueryRowContext(ctx, query, networkID, ipAddress).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check IP availability: %w", err)
	}

	return count == 0, nil
}

// =============================================================================
// MAC ADDRESS OPERATIONS
// =============================================================================

// RegisterMAC registers a MAC address.
func (r *IPAMRepository) RegisterMAC(ctx context.Context, mac *MACRegistry) error {
	query := `
		INSERT INTO mac_registry (id, mac_address, port_id, vm_id, project_id)
		VALUES ($1, $2, $3, $4, $5)
	`

	_, err := r.db.ExecContext(ctx, query,
		mac.ID, mac.MACAddress, mac.PortID, mac.VMID, mac.ProjectID,
	)

	if err != nil {
		return fmt.Errorf("failed to register MAC: %w", err)
	}

	return nil
}

// UnregisterMAC removes a MAC address registration.
func (r *IPAMRepository) UnregisterMAC(ctx context.Context, macAddress string) error {
	query := `DELETE FROM mac_registry WHERE mac_address = $1`
	_, err := r.db.ExecContext(ctx, query, macAddress)
	return err
}

// IsMACAvailable checks if a MAC address is available.
func (r *IPAMRepository) IsMACAvailable(ctx context.Context, macAddress string) (bool, error) {
	query := `SELECT COUNT(*) FROM mac_registry WHERE mac_address = $1`

	var count int
	err := r.db.QueryRowContext(ctx, query, macAddress).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("failed to check MAC availability: %w", err)
	}

	return count == 0, nil
}

// GenerateMAC generates a new unique MAC address.
func (r *IPAMRepository) GenerateMAC(ctx context.Context) (string, error) {
	// Try up to 10 times to generate a unique MAC
	for i := 0; i < 10; i++ {
		query := `SELECT generate_random_mac()`

		var mac string
		err := r.db.QueryRowContext(ctx, query).Scan(&mac)
		if err != nil {
			return "", fmt.Errorf("failed to generate MAC: %w", err)
		}

		// Check if it's available
		available, err := r.IsMACAvailable(ctx, mac)
		if err != nil {
			return "", err
		}

		if available {
			return mac, nil
		}
	}

	return "", fmt.Errorf("failed to generate unique MAC after 10 attempts")
}

// =============================================================================
// DHCP STATIC BINDING OPERATIONS
// =============================================================================

// CreateStaticBinding creates a static DHCP binding.
func (r *IPAMRepository) CreateStaticBinding(ctx context.Context, binding *DHCPStaticBinding) error {
	query := `
		INSERT INTO dhcp_static_bindings (
			id, network_id, pool_id, mac_address, ip_address,
			hostname, description, enabled
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	_, err := r.db.ExecContext(ctx, query,
		binding.ID, binding.NetworkID, binding.PoolID,
		binding.MACAddress, binding.IPAddress,
		binding.Hostname, binding.Description, binding.Enabled,
	)

	if err != nil {
		return fmt.Errorf("failed to create static binding: %w", err)
	}

	return nil
}

// GetStaticBindingByMAC retrieves a static binding by MAC address.
func (r *IPAMRepository) GetStaticBindingByMAC(ctx context.Context, networkID, macAddress string) (*DHCPStaticBinding, error) {
	query := `
		SELECT id, network_id, pool_id, mac_address, ip_address,
			   hostname, description, enabled, created_at, updated_at
		FROM dhcp_static_bindings
		WHERE network_id = $1 AND mac_address = $2 AND enabled = true
	`

	binding := &DHCPStaticBinding{}
	err := r.db.QueryRowContext(ctx, query, networkID, macAddress).Scan(
		&binding.ID, &binding.NetworkID, &binding.PoolID,
		&binding.MACAddress, &binding.IPAddress,
		&binding.Hostname, &binding.Description, &binding.Enabled,
		&binding.CreatedAt, &binding.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get static binding: %w", err)
	}

	return binding, nil
}

// ListStaticBindings lists all static bindings for a network.
func (r *IPAMRepository) ListStaticBindings(ctx context.Context, networkID string) ([]*DHCPStaticBinding, error) {
	query := `
		SELECT id, network_id, pool_id, mac_address, ip_address,
			   hostname, description, enabled, created_at, updated_at
		FROM dhcp_static_bindings
		WHERE network_id = $1
		ORDER BY ip_address
	`

	rows, err := r.db.QueryContext(ctx, query, networkID)
	if err != nil {
		return nil, fmt.Errorf("failed to list static bindings: %w", err)
	}
	defer rows.Close()

	var bindings []*DHCPStaticBinding
	for rows.Next() {
		binding := &DHCPStaticBinding{}
		err := rows.Scan(
			&binding.ID, &binding.NetworkID, &binding.PoolID,
			&binding.MACAddress, &binding.IPAddress,
			&binding.Hostname, &binding.Description, &binding.Enabled,
			&binding.CreatedAt, &binding.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan static binding: %w", err)
		}
		bindings = append(bindings, binding)
	}

	return bindings, nil
}

// DeleteStaticBinding deletes a static binding.
func (r *IPAMRepository) DeleteStaticBinding(ctx context.Context, bindingID string) error {
	query := `DELETE FROM dhcp_static_bindings WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, bindingID)
	return err
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// CalculatePoolSize calculates the number of usable IPs in a CIDR.
func CalculatePoolSize(cidr string) (int, error) {
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return 0, fmt.Errorf("invalid CIDR: %w", err)
	}

	ones, bits := ipNet.Mask.Size()
	total := 1 << uint(bits-ones)

	// Subtract network and broadcast addresses
	if total < 4 {
		return 1, nil
	}
	return total - 2, nil
}

// CalculateAllocationRange calculates start and end IPs for allocation.
func CalculateAllocationRange(cidr, gateway string) (start, end string, err error) {
	ip, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return "", "", fmt.Errorf("invalid CIDR: %w", err)
	}

	// Get network address
	networkIP := ip.Mask(ipNet.Mask)

	// Get broadcast address
	broadcastIP := make(net.IP, len(networkIP))
	for i := range networkIP {
		broadcastIP[i] = networkIP[i] | ^ipNet.Mask[i]
	}

	// Start at network + 1, end at broadcast - 1
	startIP := make(net.IP, len(networkIP))
	copy(startIP, networkIP)
	incrementIP(startIP)

	endIP := make(net.IP, len(broadcastIP))
	copy(endIP, broadcastIP)
	decrementIP(endIP)

	return startIP.String(), endIP.String(), nil
}

func incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			break
		}
	}
}

func decrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]--
		if ip[i] != 255 {
			break
		}
	}
}
