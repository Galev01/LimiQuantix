// Package ovn implements the ACL translator for converting security group rules
// to OVN ACL rules. This is the core of QuantumNet's distributed firewall.
package ovn

import (
	"fmt"
	"strings"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// =============================================================================
// ACL TRANSLATOR
// =============================================================================

// ACLTranslator converts security group rules to OVN ACLs.
type ACLTranslator struct {
	logger *zap.Logger
}

// NewACLTranslator creates a new ACL translator.
func NewACLTranslator(logger *zap.Logger) *ACLTranslator {
	return &ACLTranslator{
		logger: logger.Named("acl-translator"),
	}
}

// =============================================================================
// PRIORITY SCHEME
// =============================================================================

// ACL priority scheme for QuantumNet:
//
// | Priority | Purpose                                    |
// |----------|-------------------------------------------|
// | 32767    | Allow established/related (stateful)       |
// | 32000    | Drop invalid packets                       |
// | 2000-2999| Admin override rules                       |
// | 1000-1999| User security group rules                  |
// | 100      | Default egress allow                       |
// | 0        | Default deny (implicit in OVN)             |
const (
	PriorityStatefulEstablished = 32767
	PriorityDropInvalid         = 32000
	PriorityAdminRuleBase       = 2000
	PriorityUserRuleBase        = 1000
	PriorityDefaultEgressAllow  = 100
	PriorityDefaultDeny         = 0
)

// =============================================================================
// TRANSLATION
// =============================================================================

// TranslateSecurityGroup converts a security group to OVN ACLs.
// Returns the list of ACLs and the port group that should contain them.
func (t *ACLTranslator) TranslateSecurityGroup(sg *domain.SecurityGroup) ([]*ACL, *PortGroup, error) {
	if sg == nil {
		return nil, nil, fmt.Errorf("security group is nil")
	}

	t.logger.Info("Translating security group to OVN ACLs",
		zap.String("sg_id", sg.ID),
		zap.String("sg_name", sg.Name),
		zap.Int("rule_count", len(sg.Rules)),
		zap.Bool("stateful", sg.Stateful),
	)

	pgName := formatPortGroupName(sg.ID)
	var acls []*ACL

	// 1. Stateful connection tracking (allow established/related)
	if sg.Stateful {
		acls = append(acls, t.createStatefulACLs(pgName)...)
	}

	// 2. Translate each user rule
	for _, rule := range sg.Rules {
		acl, err := t.translateRule(&rule, pgName, sg.Stateful)
		if err != nil {
			t.logger.Warn("Failed to translate rule",
				zap.String("rule_id", rule.ID),
				zap.Error(err),
			)
			continue
		}
		acl.ExternalIDs["limiquantix-sg-id"] = sg.ID
		acls = append(acls, acl)
	}

	// 3. Default egress allow (typical behavior)
	acls = append(acls, t.createDefaultEgressAllow(pgName))

	// 4. Create port group
	pg := &PortGroup{
		UUID:  generateUUID(),
		Name:  pgName,
		Ports: []string{},
		ACLs:  make([]string, len(acls)),
		ExternalIDs: map[string]string{
			"limiquantix-sg-id":   sg.ID,
			"limiquantix-sg-name": sg.Name,
		},
	}

	for i, acl := range acls {
		pg.ACLs[i] = acl.UUID
	}

	t.logger.Info("Translated security group",
		zap.String("sg_id", sg.ID),
		zap.Int("acl_count", len(acls)),
		zap.String("port_group", pgName),
	)

	return acls, pg, nil
}

// TranslateRule converts a single security group rule to an OVN ACL.
func (t *ACLTranslator) TranslateRule(rule *domain.SecurityGroupRule, sgID string, stateful bool) (*ACL, error) {
	pgName := formatPortGroupName(sgID)
	acl, err := t.translateRule(rule, pgName, stateful)
	if err != nil {
		return nil, err
	}
	acl.ExternalIDs["limiquantix-sg-id"] = sgID
	return acl, nil
}

// translateRule converts a security group rule to an OVN ACL.
func (t *ACLTranslator) translateRule(rule *domain.SecurityGroupRule, pgName string, stateful bool) (*ACL, error) {
	// Determine OVN direction
	direction := t.translateDirection(rule.Direction)

	// Build match expression
	match, err := t.buildMatchExpression(rule, pgName)
	if err != nil {
		return nil, fmt.Errorf("failed to build match expression: %w", err)
	}

	// Determine action
	action := t.translateAction(rule.Action, stateful)

	// Calculate priority
	priority := PriorityUserRuleBase + int(rule.Priority)
	if priority > PriorityAdminRuleBase-1 {
		priority = PriorityAdminRuleBase - 1 // Cap at admin level
	}

	name := rule.Description
	if name == "" {
		name = fmt.Sprintf("rule-%s", rule.ID[:8])
	}

	acl := &ACL{
		UUID:      generateUUID(),
		Direction: direction,
		Priority:  priority,
		Match:     match,
		Action:    action,
		Name:      &name,
		ExternalIDs: map[string]string{
			"limiquantix-rule-id": rule.ID,
		},
	}

	t.logger.Debug("Translated rule to ACL",
		zap.String("rule_id", rule.ID),
		zap.String("direction", direction),
		zap.Int("priority", priority),
		zap.String("match", match),
		zap.String("action", action),
	)

	return acl, nil
}

// =============================================================================
// MATCH EXPRESSION BUILDER
// =============================================================================

// buildMatchExpression builds the OVN match expression for a rule.
func (t *ACLTranslator) buildMatchExpression(rule *domain.SecurityGroupRule, pgName string) (string, error) {
	var parts []string

	// 1. Port group match (which ports this rule applies to)
	if rule.Direction == domain.RuleDirectionIngress {
		// Ingress: match on destination port (outport in to-lport direction)
		parts = append(parts, fmt.Sprintf("outport == @%s", pgName))
	} else {
		// Egress: match on source port (inport in from-lport direction)
		parts = append(parts, fmt.Sprintf("inport == @%s", pgName))
	}

	// 2. IP version
	// For now, assume IPv4. Can extend to IPv6 based on remote_ip_prefix format.
	if rule.RemoteIPPrefix != "" && strings.Contains(rule.RemoteIPPrefix, ":") {
		parts = append(parts, "ip6")
	} else {
		parts = append(parts, "ip4")
	}

	// 3. Protocol match
	if rule.Protocol != "" && rule.Protocol != "any" {
		protocolMatch, err := t.buildProtocolMatch(rule)
		if err != nil {
			return "", err
		}
		parts = append(parts, protocolMatch...)
	}

	// 4. Remote IP prefix
	if rule.RemoteIPPrefix != "" && rule.RemoteIPPrefix != "0.0.0.0/0" && rule.RemoteIPPrefix != "::/0" {
		ipMatch := t.buildRemoteIPMatch(rule)
		if ipMatch != "" {
			parts = append(parts, ipMatch)
		}
	}

	// 5. Remote security group (for group-to-group rules)
	if rule.RemoteSecurityGroupID != "" {
		remotePG := formatPortGroupName(rule.RemoteSecurityGroupID)
		if rule.Direction == domain.RuleDirectionIngress {
			// Source must be in the remote security group
			parts = append(parts, fmt.Sprintf("inport == @%s", remotePG))
		} else {
			// Destination must be in the remote security group
			parts = append(parts, fmt.Sprintf("outport == @%s", remotePG))
		}
	}

	return strings.Join(parts, " && "), nil
}

// buildProtocolMatch builds the protocol-specific part of the match expression.
func (t *ACLTranslator) buildProtocolMatch(rule *domain.SecurityGroupRule) ([]string, error) {
	var parts []string

	protocol := strings.ToLower(rule.Protocol)

	switch protocol {
	case "tcp", "udp", "sctp":
		parts = append(parts, protocol)

		// Port range
		if rule.PortMin > 0 {
			if rule.PortMin == rule.PortMax {
				// Single port
				parts = append(parts, fmt.Sprintf("%s.dst == %d", protocol, rule.PortMin))
			} else if rule.PortMax > rule.PortMin {
				// Port range
				parts = append(parts, fmt.Sprintf("%s.dst >= %d", protocol, rule.PortMin))
				parts = append(parts, fmt.Sprintf("%s.dst <= %d", protocol, rule.PortMax))
			}
		}

	case "icmp":
		parts = append(parts, "icmp4")

		// ICMP type
		if rule.ICMPType >= 0 {
			parts = append(parts, fmt.Sprintf("icmp4.type == %d", rule.ICMPType))
		}

		// ICMP code
		if rule.ICMPCode >= 0 {
			parts = append(parts, fmt.Sprintf("icmp4.code == %d", rule.ICMPCode))
		}

	case "icmpv6":
		parts = append(parts, "icmp6")

		if rule.ICMPType >= 0 {
			parts = append(parts, fmt.Sprintf("icmp6.type == %d", rule.ICMPType))
		}
		if rule.ICMPCode >= 0 {
			parts = append(parts, fmt.Sprintf("icmp6.code == %d", rule.ICMPCode))
		}

	case "gre":
		parts = append(parts, "ip.proto == 47")

	case "esp":
		parts = append(parts, "ip.proto == 50")

	case "ah":
		parts = append(parts, "ip.proto == 51")

	case "vrrp":
		parts = append(parts, "ip.proto == 112")

	default:
		// Try to parse as protocol number
		if protocol != "" {
			parts = append(parts, fmt.Sprintf("ip.proto == %s", protocol))
		}
	}

	return parts, nil
}

// buildRemoteIPMatch builds the remote IP match expression.
func (t *ACLTranslator) buildRemoteIPMatch(rule *domain.SecurityGroupRule) string {
	if rule.RemoteIPPrefix == "" {
		return ""
	}

	// Determine IP version
	isIPv6 := strings.Contains(rule.RemoteIPPrefix, ":")
	var ipField string

	if rule.Direction == domain.RuleDirectionIngress {
		// For ingress, match source IP
		if isIPv6 {
			ipField = "ip6.src"
		} else {
			ipField = "ip4.src"
		}
	} else {
		// For egress, match destination IP
		if isIPv6 {
			ipField = "ip6.dst"
		} else {
			ipField = "ip4.dst"
		}
	}

	return fmt.Sprintf("%s == %s", ipField, rule.RemoteIPPrefix)
}

// =============================================================================
// DIRECTION AND ACTION TRANSLATION
// =============================================================================

// translateDirection converts security group direction to OVN ACL direction.
func (t *ACLTranslator) translateDirection(direction domain.RuleDirection) string {
	switch direction {
	case domain.RuleDirectionIngress:
		// Ingress rules are applied when packets enter a port
		// In OVN, "to-lport" means "traffic going to the logical port"
		return "to-lport"
	case domain.RuleDirectionEgress:
		// Egress rules are applied when packets leave a port
		// In OVN, "from-lport" means "traffic coming from the logical port"
		return "from-lport"
	default:
		return "to-lport"
	}
}

// translateAction converts security group action to OVN ACL action.
func (t *ACLTranslator) translateAction(action domain.RuleAction, stateful bool) string {
	switch action {
	case domain.RuleActionAllow:
		if stateful {
			// "allow-related" enables connection tracking
			return "allow-related"
		}
		return "allow"
	case domain.RuleActionDrop:
		return "drop"
	case domain.RuleActionReject:
		// "reject" sends ICMP unreachable
		return "reject"
	default:
		if stateful {
			return "allow-related"
		}
		return "allow"
	}
}

// =============================================================================
// DEFAULT ACLs
// =============================================================================

// createStatefulACLs creates ACLs for stateful connection tracking.
func (t *ACLTranslator) createStatefulACLs(pgName string) []*ACL {
	var acls []*ACL

	// Allow established connections (to-lport)
	estName := "stateful-established-ingress"
	acls = append(acls, &ACL{
		UUID:      generateUUID(),
		Direction: "to-lport",
		Priority:  PriorityStatefulEstablished,
		Match:     fmt.Sprintf("outport == @%s && ct.est && !ct.new", pgName),
		Action:    "allow",
		Name:      &estName,
		ExternalIDs: map[string]string{
			"limiquantix-builtin": "stateful-established",
		},
	})

	// Allow established connections (from-lport)
	estEgressName := "stateful-established-egress"
	acls = append(acls, &ACL{
		UUID:      generateUUID(),
		Direction: "from-lport",
		Priority:  PriorityStatefulEstablished,
		Match:     fmt.Sprintf("inport == @%s && ct.est && !ct.new", pgName),
		Action:    "allow",
		Name:      &estEgressName,
		ExternalIDs: map[string]string{
			"limiquantix-builtin": "stateful-established",
		},
	})

	// Allow related connections (ICMP errors, etc.)
	relName := "stateful-related-ingress"
	acls = append(acls, &ACL{
		UUID:      generateUUID(),
		Direction: "to-lport",
		Priority:  PriorityStatefulEstablished - 1,
		Match:     fmt.Sprintf("outport == @%s && ct.rel && !ct.new", pgName),
		Action:    "allow",
		Name:      &relName,
		ExternalIDs: map[string]string{
			"limiquantix-builtin": "stateful-related",
		},
	})

	// Drop invalid packets
	invalidName := "drop-invalid"
	acls = append(acls, &ACL{
		UUID:      generateUUID(),
		Direction: "to-lport",
		Priority:  PriorityDropInvalid,
		Match:     fmt.Sprintf("outport == @%s && ct.inv", pgName),
		Action:    "drop",
		Name:      &invalidName,
		ExternalIDs: map[string]string{
			"limiquantix-builtin": "drop-invalid",
		},
	})

	return acls
}

// createDefaultEgressAllow creates the default egress allow ACL.
// This allows all outbound traffic by default (typical security model).
func (t *ACLTranslator) createDefaultEgressAllow(pgName string) *ACL {
	name := "default-egress-allow"
	return &ACL{
		UUID:      generateUUID(),
		Direction: "from-lport",
		Priority:  PriorityDefaultEgressAllow,
		Match:     fmt.Sprintf("inport == @%s", pgName),
		Action:    "allow",
		Name:      &name,
		ExternalIDs: map[string]string{
			"limiquantix-builtin": "default-egress-allow",
		},
	}
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// formatPortGroupName formats a security group ID to an OVN port group name.
func formatPortGroupName(sgID string) string {
	// OVN port group names must be valid identifiers
	// Replace dashes with underscores and prefix
	return fmt.Sprintf("pg_sg_%s", strings.ReplaceAll(sgID, "-", "_"))
}

// formatAddressSetName formats a security group ID to an OVN address set name.
func formatAddressSetName(sgID string) string {
	return fmt.Sprintf("as_sg_%s", strings.ReplaceAll(sgID, "-", "_"))
}

// =============================================================================
// PRESET SECURITY GROUPS
// =============================================================================

// SecurityGroupPreset defines a preset security group template.
type SecurityGroupPreset struct {
	Name        string
	Description string
	Rules       []domain.SecurityGroupRule
}

// GetPresets returns the built-in security group presets.
func GetPresets() []SecurityGroupPreset {
	return []SecurityGroupPreset{
		{
			Name:        "allow-ssh",
			Description: "Allow SSH access",
			Rules: []domain.SecurityGroupRule{
				{
					ID:          "allow-ssh-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     22,
					PortMax:     22,
					Action:      domain.RuleActionAllow,
					Description: "Allow SSH (TCP 22)",
				},
			},
		},
		{
			Name:        "allow-web",
			Description: "Allow HTTP and HTTPS traffic",
			Rules: []domain.SecurityGroupRule{
				{
					ID:          "allow-http-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     80,
					PortMax:     80,
					Action:      domain.RuleActionAllow,
					Description: "Allow HTTP (TCP 80)",
				},
				{
					ID:          "allow-https-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     443,
					PortMax:     443,
					Action:      domain.RuleActionAllow,
					Description: "Allow HTTPS (TCP 443)",
				},
			},
		},
		{
			Name:        "allow-rdp",
			Description: "Allow RDP access",
			Rules: []domain.SecurityGroupRule{
				{
					ID:          "allow-rdp-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     3389,
					PortMax:     3389,
					Action:      domain.RuleActionAllow,
					Description: "Allow RDP (TCP 3389)",
				},
			},
		},
		{
			Name:        "allow-icmp",
			Description: "Allow ICMP (ping)",
			Rules: []domain.SecurityGroupRule{
				{
					ID:          "allow-icmp-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "icmp",
					ICMPType:    -1, // All types
					ICMPCode:    -1, // All codes
					Action:      domain.RuleActionAllow,
					Description: "Allow all ICMP",
				},
			},
		},
		{
			Name:        "allow-database",
			Description: "Allow common database ports",
			Rules: []domain.SecurityGroupRule{
				{
					ID:          "allow-mysql-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     3306,
					PortMax:     3306,
					Action:      domain.RuleActionAllow,
					Description: "Allow MySQL (TCP 3306)",
				},
				{
					ID:          "allow-postgres-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     5432,
					PortMax:     5432,
					Action:      domain.RuleActionAllow,
					Description: "Allow PostgreSQL (TCP 5432)",
				},
				{
					ID:          "allow-mongodb-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     27017,
					PortMax:     27017,
					Action:      domain.RuleActionAllow,
					Description: "Allow MongoDB (TCP 27017)",
				},
				{
					ID:          "allow-redis-rule",
					Direction:   domain.RuleDirectionIngress,
					Protocol:    "tcp",
					PortMin:     6379,
					PortMax:     6379,
					Action:      domain.RuleActionAllow,
					Description: "Allow Redis (TCP 6379)",
				},
			},
		},
		{
			Name:        "allow-internal",
			Description: "Allow all internal RFC1918 traffic",
			Rules: []domain.SecurityGroupRule{
				{
					ID:             "allow-10-rule",
					Direction:      domain.RuleDirectionIngress,
					Protocol:       "any",
					RemoteIPPrefix: "10.0.0.0/8",
					Action:         domain.RuleActionAllow,
					Description:    "Allow 10.0.0.0/8",
				},
				{
					ID:             "allow-172-rule",
					Direction:      domain.RuleDirectionIngress,
					Protocol:       "any",
					RemoteIPPrefix: "172.16.0.0/12",
					Action:         domain.RuleActionAllow,
					Description:    "Allow 172.16.0.0/12",
				},
				{
					ID:             "allow-192-rule",
					Direction:      domain.RuleDirectionIngress,
					Protocol:       "any",
					RemoteIPPrefix: "192.168.0.0/16",
					Action:         domain.RuleActionAllow,
					Description:    "Allow 192.168.0.0/16",
				},
			},
		},
	}
}
