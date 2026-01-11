// Package domain provides the core domain models for Quantix-KVM.
package domain

import (
	"time"
)

// CustomizationSpecType represents the OS type for customization.
type CustomizationSpecType string

const (
	// CustomizationSpecTypeLinux is for Linux guest OS customization.
	CustomizationSpecTypeLinux CustomizationSpecType = "LINUX"
	// CustomizationSpecTypeWindows is for Windows guest OS customization.
	CustomizationSpecTypeWindows CustomizationSpecType = "WINDOWS"
)

// CustomizationSpec represents a reusable guest OS customization specification.
// This is similar to VMware's Customization Specifications for automating VM provisioning.
type CustomizationSpec struct {
	// ID is the unique identifier (UUIDv4).
	ID string `json:"id"`

	// Name is the display name of the specification.
	Name string `json:"name"`

	// Description is an optional description.
	Description string `json:"description,omitempty"`

	// ProjectID is the project/tenant this spec belongs to.
	ProjectID string `json:"project_id"`

	// Type indicates the target OS type (Linux or Windows).
	Type CustomizationSpecType `json:"type"`

	// LinuxSpec contains Linux-specific customization settings.
	LinuxSpec *LinuxCustomization `json:"linux_spec,omitempty"`

	// WindowsSpec contains Windows-specific customization settings.
	WindowsSpec *WindowsCustomization `json:"windows_spec,omitempty"`

	// Network contains network customization settings.
	Network *NetworkCustomization `json:"network,omitempty"`

	// InstallAgent specifies whether to install the Quantix guest agent.
	InstallAgent bool `json:"install_agent"`

	// Labels for additional metadata.
	Labels map[string]string `json:"labels,omitempty"`

	// Timestamps.
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	CreatedBy string    `json:"created_by,omitempty"`
}

// LinuxCustomization contains Linux-specific customization settings.
type LinuxCustomization struct {
	// HostnameTemplate is a template for the hostname (e.g., "vm-{name}-{id}").
	HostnameTemplate string `json:"hostname_template,omitempty"`

	// Domain is the DNS domain name.
	Domain string `json:"domain,omitempty"`

	// Timezone is the timezone identifier (e.g., "America/New_York", "UTC").
	Timezone string `json:"timezone,omitempty"`

	// Users contains user accounts to create.
	Users []UserAccount `json:"users,omitempty"`

	// SSHAuthorizedKeys are SSH public keys to add to the default user.
	SSHAuthorizedKeys []string `json:"ssh_authorized_keys,omitempty"`

	// RunCommands are commands to run during first boot.
	RunCommands []string `json:"run_commands,omitempty"`

	// Packages are packages to install during provisioning.
	Packages []string `json:"packages,omitempty"`

	// Scripts are custom scripts to execute.
	Scripts []CustomizationScript `json:"scripts,omitempty"`
}

// WindowsCustomization contains Windows-specific customization settings.
type WindowsCustomization struct {
	// ComputerNameTemplate is a template for the computer name.
	ComputerNameTemplate string `json:"computer_name_template,omitempty"`

	// ProductKey is the Windows product key.
	ProductKey string `json:"product_key,omitempty"`

	// Timezone is the Windows timezone name.
	Timezone string `json:"timezone,omitempty"`

	// AdminPassword is the Administrator password.
	AdminPassword string `json:"admin_password,omitempty"`

	// AutoLogon enables automatic login after setup.
	AutoLogon bool `json:"auto_logon,omitempty"`

	// AutoLogonCount is the number of times to auto-logon.
	AutoLogonCount int `json:"auto_logon_count,omitempty"`

	// JoinDomain contains domain join settings.
	JoinDomain *DomainJoinSettings `json:"join_domain,omitempty"`

	// Workgroup is the workgroup name (if not joining a domain).
	Workgroup string `json:"workgroup,omitempty"`

	// RunOnce are commands to run on first logon.
	RunOnce []string `json:"run_once,omitempty"`
}

// UserAccount represents a user account to create.
type UserAccount struct {
	// Name is the username.
	Name string `json:"name"`

	// Password is the password (will be hashed).
	Password string `json:"password,omitempty"`

	// PasswordHash is the pre-hashed password.
	PasswordHash string `json:"password_hash,omitempty"`

	// SSHAuthorizedKeys are SSH public keys for this user.
	SSHAuthorizedKeys []string `json:"ssh_authorized_keys,omitempty"`

	// Groups are the groups this user belongs to.
	Groups []string `json:"groups,omitempty"`

	// Shell is the login shell.
	Shell string `json:"shell,omitempty"`

	// Sudo enables sudo access.
	Sudo bool `json:"sudo,omitempty"`

	// NoPasswordSudo allows sudo without password.
	NoPasswordSudo bool `json:"no_password_sudo,omitempty"`
}

// DomainJoinSettings contains Windows domain join settings.
type DomainJoinSettings struct {
	// DomainName is the Active Directory domain to join.
	DomainName string `json:"domain_name"`

	// Username is the domain join username.
	Username string `json:"username"`

	// Password is the domain join password.
	Password string `json:"password"`

	// OUPath is the organizational unit path for the computer object.
	OUPath string `json:"ou_path,omitempty"`
}

// NetworkCustomization contains network customization settings.
type NetworkCustomization struct {
	// UseDHCP enables DHCP for all interfaces.
	UseDHCP bool `json:"use_dhcp"`

	// DNSServers are custom DNS servers.
	DNSServers []string `json:"dns_servers,omitempty"`

	// DNSSuffixes are DNS search suffixes.
	DNSSuffixes []string `json:"dns_suffixes,omitempty"`

	// Interfaces contains per-interface settings.
	Interfaces []NetworkInterfaceCustomization `json:"interfaces,omitempty"`
}

// NetworkInterfaceCustomization contains per-interface network settings.
type NetworkInterfaceCustomization struct {
	// InterfaceIndex is the interface index (0-based).
	InterfaceIndex int `json:"interface_index"`

	// UseDHCP enables DHCP for this interface.
	UseDHCP bool `json:"use_dhcp"`

	// StaticIP is the static IP address.
	StaticIP string `json:"static_ip,omitempty"`

	// SubnetMask is the subnet mask.
	SubnetMask string `json:"subnet_mask,omitempty"`

	// Gateway is the default gateway.
	Gateway string `json:"gateway,omitempty"`
}

// CustomizationScript represents a script to execute.
type CustomizationScript struct {
	// Name is a friendly name for the script.
	Name string `json:"name"`

	// Content is the script content.
	Content string `json:"content"`

	// Type is the script type (e.g., "bash", "powershell").
	Type string `json:"type"`

	// RunAs is the user to run the script as.
	RunAs string `json:"run_as,omitempty"`

	// Order is the execution order.
	Order int `json:"order,omitempty"`
}

// Validate checks if the customization spec has valid data.
func (c *CustomizationSpec) Validate() error {
	if c.Name == "" {
		return ErrInvalidArgument
	}
	if c.ProjectID == "" {
		return ErrInvalidArgument
	}
	if c.Type == "" {
		return ErrInvalidArgument
	}
	return nil
}

// CustomizationSpecFilter defines filter criteria for listing specs.
type CustomizationSpecFilter struct {
	ProjectID string                `json:"project_id,omitempty"`
	Type      CustomizationSpecType `json:"type,omitempty"`
	Name      string                `json:"name,omitempty"`
}
