// Package network provides converters between protobuf and domain types.
package network

import (
	"time"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	networkv1 "github.com/Quantixkvm/Quantixkvm/pkg/api/Quantixkvm/network/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// =============================================================================
// VIRTUAL NETWORK CONVERTERS
// =============================================================================

// convertNetworkToProto converts a domain.VirtualNetwork to networkv1.VirtualNetwork.
func convertNetworkToProto(net *domain.VirtualNetwork) *networkv1.VirtualNetwork {
	if net == nil {
		return nil
	}

	return &networkv1.VirtualNetwork{
		Id:          net.ID,
		Name:        net.Name,
		ProjectId:   net.ProjectID,
		Description: net.Description,
		Labels:      net.Labels,
		Spec:        convertNetworkSpecToProto(&net.Spec),
		Status:      convertNetworkStatusToProto(&net.Status),
		CreatedAt:   timestamppb.New(net.CreatedAt),
		UpdatedAt:   timestamppb.New(net.UpdatedAt),
	}
}

// convertNetworkSpecToProto converts domain.VirtualNetworkSpec to networkv1.VirtualNetworkSpec.
func convertNetworkSpecToProto(spec *domain.VirtualNetworkSpec) *networkv1.VirtualNetworkSpec {
	if spec == nil {
		return nil
	}

	protoSpec := &networkv1.VirtualNetworkSpec{
		Type:                   networkv1.VirtualNetworkSpec_NetworkType(networkv1.VirtualNetworkSpec_NetworkType_value[string(spec.Type)]),
		Mtu:                    spec.MTU,
		DefaultSecurityGroupId: spec.DefaultSecurityGroupID,
		PortSecurityEnabled:    spec.PortSecurityEnabled,
		IpConfig: &networkv1.IpAddressManagement{
			Ipv4Subnet:  spec.IPConfig.IPv4Subnet,
			Ipv4Gateway: spec.IPConfig.IPv4Gateway,
			Ipv6Subnet:  spec.IPConfig.IPv6Subnet,
			Ipv6Gateway: spec.IPConfig.IPv6Gateway,
			ReservedIps: spec.IPConfig.ReservedIPs,
			Dhcp: &networkv1.DhcpConfig{
				Enabled:      spec.IPConfig.DHCP.Enabled,
				LeaseTimeSec: spec.IPConfig.DHCP.LeaseTimeSec,
				DnsServers:   spec.IPConfig.DHCP.DNSServers,
				NtpServers:   spec.IPConfig.DHCP.NTPServers,
				DomainName:   spec.IPConfig.DHCP.DomainName,
			},
		},
		Dns: &networkv1.DnsConfig{
			Nameservers:   spec.DNS.Nameservers,
			SearchDomains: spec.DNS.SearchDomains,
		},
	}

	// Convert allocation pools
	for _, pool := range spec.IPConfig.AllocationPools {
		protoSpec.IpConfig.AllocationPools = append(protoSpec.IpConfig.AllocationPools, &networkv1.IpRange{
			Start: pool.Start,
			End:   pool.End,
		})
	}

	// Convert router config
	if spec.Router != nil {
		protoSpec.Router = &networkv1.RouterConfig{
			Enabled:                  spec.Router.Enabled,
			ExternalGatewayNetworkId: spec.Router.ExternalGatewayNetworkID,
			EnableSnat:               spec.Router.EnableSNAT,
		}
		for _, route := range spec.Router.Routes {
			protoSpec.Router.Routes = append(protoSpec.Router.Routes, &networkv1.StaticRoute{
				Destination: route.Destination,
				NextHop:     route.NextHop,
			})
		}
	}

	return protoSpec
}

// convertNetworkStatusToProto converts domain.VirtualNetworkStatus to networkv1.VirtualNetworkStatus.
func convertNetworkStatusToProto(status *domain.VirtualNetworkStatus) *networkv1.VirtualNetworkStatus {
	if status == nil {
		return nil
	}

	return &networkv1.VirtualNetworkStatus{
		Phase:            networkv1.VirtualNetworkStatus_Phase(networkv1.VirtualNetworkStatus_Phase_value[string(status.Phase)]),
		OvnLogicalSwitch: status.OVNLogicalSwitch,
		OvnLogicalRouter: status.OVNLogicalRouter,
		PortCount:        status.PortCount,
		IpStatus: &networkv1.IpAllocationStatus{
			Ipv4Total:     status.IPAllocationStatus.IPv4Total,
			Ipv4Allocated: status.IPAllocationStatus.IPv4Allocated,
			Ipv4Available: status.IPAllocationStatus.IPv4Available,
			Ipv6Allocated: status.IPAllocationStatus.IPv6Allocated,
		},
		ErrorMessage: status.ErrorMessage,
	}
}

// convertCreateNetworkRequestToDomain converts a CreateNetworkRequest to domain.VirtualNetwork.
func convertCreateNetworkRequestToDomain(req *networkv1.CreateNetworkRequest) *domain.VirtualNetwork {
	net := &domain.VirtualNetwork{
		Name:        req.Name,
		ProjectID:   req.ProjectId,
		Description: req.Description,
		Labels:      req.Labels,
		Status: domain.VirtualNetworkStatus{
			Phase: domain.NetworkPhasePending,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if req.Spec != nil {
		net.Spec = *convertNetworkSpecFromProto(req.Spec)
	}

	return net
}

// convertNetworkSpecFromProto converts networkv1.VirtualNetworkSpec to domain.VirtualNetworkSpec.
func convertNetworkSpecFromProto(spec *networkv1.VirtualNetworkSpec) *domain.VirtualNetworkSpec {
	if spec == nil {
		return nil
	}

	domainSpec := &domain.VirtualNetworkSpec{
		Type:                   domain.NetworkType(spec.Type.String()),
		MTU:                    spec.Mtu,
		DefaultSecurityGroupID: spec.DefaultSecurityGroupId,
		PortSecurityEnabled:    spec.PortSecurityEnabled,
	}

	if spec.IpConfig != nil {
		domainSpec.IPConfig = domain.IPAddressConfig{
			IPv4Subnet:  spec.IpConfig.Ipv4Subnet,
			IPv4Gateway: spec.IpConfig.Ipv4Gateway,
			IPv6Subnet:  spec.IpConfig.Ipv6Subnet,
			IPv6Gateway: spec.IpConfig.Ipv6Gateway,
			ReservedIPs: spec.IpConfig.ReservedIps,
		}
		if spec.IpConfig.Dhcp != nil {
			domainSpec.IPConfig.DHCP = domain.DHCPConfig{
				Enabled:      spec.IpConfig.Dhcp.Enabled,
				LeaseTimeSec: spec.IpConfig.Dhcp.LeaseTimeSec,
				DNSServers:   spec.IpConfig.Dhcp.DnsServers,
				NTPServers:   spec.IpConfig.Dhcp.NtpServers,
				DomainName:   spec.IpConfig.Dhcp.DomainName,
			}
		}
		for _, pool := range spec.IpConfig.AllocationPools {
			domainSpec.IPConfig.AllocationPools = append(domainSpec.IPConfig.AllocationPools, domain.IPRange{
				Start: pool.Start,
				End:   pool.End,
			})
		}
	}

	if spec.Dns != nil {
		domainSpec.DNS = domain.DNSConfig{
			Nameservers:   spec.Dns.Nameservers,
			SearchDomains: spec.Dns.SearchDomains,
		}
	}

	if spec.Router != nil {
		domainSpec.Router = &domain.RouterConfig{
			Enabled:                  spec.Router.Enabled,
			ExternalGatewayNetworkID: spec.Router.ExternalGatewayNetworkId,
			EnableSNAT:               spec.Router.EnableSnat,
		}
		for _, route := range spec.Router.Routes {
			domainSpec.Router.Routes = append(domainSpec.Router.Routes, domain.StaticRoute{
				Destination: route.Destination,
				NextHop:     route.NextHop,
			})
		}
	}

	return domainSpec
}

// convertNetworkFilterFromProto converts list request to NetworkFilter.
func convertNetworkFilterFromProto(req *networkv1.ListNetworksRequest) NetworkFilter {
	return NetworkFilter{
		ProjectID:   req.ProjectId,
		NetworkType: domain.NetworkType(req.Type.String()),
		Labels:      req.Labels,
	}
}

// convertNetworksToProtos converts a slice of domain networks to proto networks.
func convertNetworksToProtos(networks []*domain.VirtualNetwork) []*networkv1.VirtualNetwork {
	if networks == nil {
		return nil
	}
	result := make([]*networkv1.VirtualNetwork, len(networks))
	for i, net := range networks {
		result[i] = convertNetworkToProto(net)
	}
	return result
}

// =============================================================================
// SECURITY GROUP CONVERTERS
// =============================================================================

// convertSecurityGroupToProto converts domain.SecurityGroup to networkv1.SecurityGroup.
func convertSecurityGroupToProto(sg *domain.SecurityGroup) *networkv1.SecurityGroup {
	if sg == nil {
		return nil
	}

	protoSG := &networkv1.SecurityGroup{
		Id:          sg.ID,
		Name:        sg.Name,
		Description: sg.Description,
		ProjectId:   sg.ProjectID,
		Labels:      sg.Labels,
		Stateful:    sg.Stateful,
		CreatedAt:   timestamppb.New(sg.CreatedAt),
		UpdatedAt:   timestamppb.New(sg.UpdatedAt),
	}

	for _, rule := range sg.Rules {
		protoSG.Rules = append(protoSG.Rules, convertRuleToProto(&rule))
	}

	return protoSG
}

// convertRuleToProto converts domain.SecurityGroupRule to networkv1.SecurityGroupRule.
func convertRuleToProto(rule *domain.SecurityGroupRule) *networkv1.SecurityGroupRule {
	if rule == nil {
		return nil
	}

	return &networkv1.SecurityGroupRule{
		Id:                    rule.ID,
		Direction:             networkv1.SecurityGroupRule_Direction(networkv1.SecurityGroupRule_Direction_value[string(rule.Direction)]),
		Protocol:              rule.Protocol,
		PortMin:               rule.PortMin,
		PortMax:               rule.PortMax,
		IcmpType:              rule.ICMPType,
		IcmpCode:              rule.ICMPCode,
		RemoteIpPrefix:        rule.RemoteIPPrefix,
		RemoteSecurityGroupId: rule.RemoteSecurityGroupID,
		Action:                networkv1.SecurityGroupRule_Action(networkv1.SecurityGroupRule_Action_value[string(rule.Action)]),
		Priority:              rule.Priority,
		Description:           rule.Description,
	}
}

// convertCreateSecurityGroupRequestToDomain converts a CreateSecurityGroupRequest.
func convertCreateSecurityGroupRequestToDomain(req *networkv1.CreateSecurityGroupRequest) *domain.SecurityGroup {
	sg := &domain.SecurityGroup{
		Name:        req.Name,
		Description: req.Description,
		ProjectID:   req.ProjectId,
		Labels:      req.Labels,
		Stateful:    req.Stateful,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	for _, rule := range req.Rules {
		sg.Rules = append(sg.Rules, *convertRuleFromProto(rule))
	}

	return sg
}

// convertRuleFromProto converts networkv1.SecurityGroupRule to domain.SecurityGroupRule.
func convertRuleFromProto(rule *networkv1.SecurityGroupRule) *domain.SecurityGroupRule {
	if rule == nil {
		return nil
	}

	return &domain.SecurityGroupRule{
		ID:                    rule.Id,
		Direction:             domain.RuleDirection(rule.Direction.String()),
		Protocol:              rule.Protocol,
		PortMin:               rule.PortMin,
		PortMax:               rule.PortMax,
		ICMPType:              rule.IcmpType,
		ICMPCode:              rule.IcmpCode,
		RemoteIPPrefix:        rule.RemoteIpPrefix,
		RemoteSecurityGroupID: rule.RemoteSecurityGroupId,
		Action:                domain.RuleAction(rule.Action.String()),
		Priority:              rule.Priority,
		Description:           rule.Description,
	}
}

// convertSecurityGroupsToProtos converts a slice of domain security groups to proto.
func convertSecurityGroupsToProtos(sgs []*domain.SecurityGroup) []*networkv1.SecurityGroup {
	if sgs == nil {
		return nil
	}
	result := make([]*networkv1.SecurityGroup, len(sgs))
	for i, sg := range sgs {
		result[i] = convertSecurityGroupToProto(sg)
	}
	return result
}
