// Package network provides the Packet Trace service for debugging OVN flows.
// This wraps the ovn-trace utility to help users understand packet paths
// and identify ACL drops in the virtual network.
package network

import (
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"go.uber.org/zap"
)

// =============================================================================
// PACKET TRACE SERVICE
// =============================================================================

// PacketTraceService provides packet tracing capabilities using ovn-trace.
type PacketTraceService struct {
	logger *zap.Logger
}

// NewPacketTraceService creates a new packet trace service.
func NewPacketTraceService(logger *zap.Logger) *PacketTraceService {
	return &PacketTraceService{
		logger: logger.Named("packet-trace"),
	}
}

// TraceRequest holds parameters for packet tracing.
type TraceRequest struct {
	// Source logical switch port
	InPort string
	// Ethernet source MAC
	EthSrc string
	// Ethernet destination MAC
	EthDst string
	// Source IP address
	IPSrc string
	// Destination IP address
	IPDst string
	// Protocol (tcp, udp, icmp)
	Protocol string
	// Source port (for TCP/UDP)
	SrcPort int
	// Destination port (for TCP/UDP)
	DstPort int
	// Logical datapath (switch or router name)
	Datapath string
}

// TraceResult holds the result of a packet trace.
type TraceResult struct {
	// Full trace output
	Output string
	// Parsed trace hops
	Hops []TraceHop
	// Final verdict (allow, drop, ct_commit, etc.)
	Verdict string
	// Drop reason if dropped
	DropReason string
	// Whether the packet was dropped
	Dropped bool
	// Time taken to run trace
	Duration time.Duration
	// Timestamp
	Timestamp time.Time
}

// TraceHop represents a single hop in the packet trace.
type TraceHop struct {
	// Datapath (logical switch/router name)
	Datapath string
	// Pipeline (ingress or egress)
	Pipeline string
	// Table number
	Table int
	// Table name
	TableName string
	// Priority of matching flow
	Priority int
	// Match condition
	Match string
	// Actions taken
	Actions string
	// Whether this hop caused a drop
	IsDrop bool
}

// TracePacket performs an ovn-trace and returns the result.
func (s *PacketTraceService) TracePacket(ctx context.Context, req TraceRequest) (*TraceResult, error) {
	s.logger.Info("Tracing packet",
		zap.String("inport", req.InPort),
		zap.String("src_ip", req.IPSrc),
		zap.String("dst_ip", req.IPDst),
		zap.String("protocol", req.Protocol),
	)

	// Build ovn-trace command
	args := s.buildTraceCommand(req)

	start := time.Now()

	// Execute ovn-trace
	cmd := exec.CommandContext(ctx, "ovn-trace", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Error("ovn-trace failed",
			zap.Error(err),
			zap.String("output", string(output)),
		)
		// Still return the output for debugging
		return &TraceResult{
			Output:    string(output),
			Dropped:   true,
			Duration:  time.Since(start),
			Timestamp: start,
		}, nil
	}

	duration := time.Since(start)

	// Parse the output
	result := s.parseTraceOutput(string(output))
	result.Duration = duration
	result.Timestamp = start

	s.logger.Info("Packet trace completed",
		zap.String("verdict", result.Verdict),
		zap.Bool("dropped", result.Dropped),
		zap.Duration("duration", duration),
	)

	return result, nil
}

// buildTraceCommand builds the ovn-trace command arguments.
func (s *PacketTraceService) buildTraceCommand(req TraceRequest) []string {
	args := []string{}

	// Add datapath if specified
	if req.Datapath != "" {
		args = append(args, req.Datapath)
	}

	// Build the flow specification
	flow := s.buildFlowSpec(req)
	args = append(args, flow)

	return args
}

// buildFlowSpec builds the flow specification string for ovn-trace.
func (s *PacketTraceService) buildFlowSpec(req TraceRequest) string {
	parts := []string{}

	// Inport
	if req.InPort != "" {
		parts = append(parts, fmt.Sprintf("inport==%q", req.InPort))
	}

	// Ethernet
	if req.EthSrc != "" {
		parts = append(parts, fmt.Sprintf("eth.src==%s", req.EthSrc))
	}
	if req.EthDst != "" {
		parts = append(parts, fmt.Sprintf("eth.dst==%s", req.EthDst))
	}

	// IP
	if req.IPSrc != "" || req.IPDst != "" {
		parts = append(parts, "eth.type==0x800") // IPv4
		if req.IPSrc != "" {
			parts = append(parts, fmt.Sprintf("ip4.src==%s", req.IPSrc))
		}
		if req.IPDst != "" {
			parts = append(parts, fmt.Sprintf("ip4.dst==%s", req.IPDst))
		}
	}

	// Protocol
	switch strings.ToLower(req.Protocol) {
	case "tcp":
		parts = append(parts, "ip.proto==6")
		if req.SrcPort > 0 {
			parts = append(parts, fmt.Sprintf("tcp.src==%d", req.SrcPort))
		}
		if req.DstPort > 0 {
			parts = append(parts, fmt.Sprintf("tcp.dst==%d", req.DstPort))
		}
	case "udp":
		parts = append(parts, "ip.proto==17")
		if req.SrcPort > 0 {
			parts = append(parts, fmt.Sprintf("udp.src==%d", req.SrcPort))
		}
		if req.DstPort > 0 {
			parts = append(parts, fmt.Sprintf("udp.dst==%d", req.DstPort))
		}
	case "icmp":
		parts = append(parts, "ip.proto==1")
	}

	return strings.Join(parts, " && ")
}

// parseTraceOutput parses the ovn-trace output.
func (s *PacketTraceService) parseTraceOutput(output string) *TraceResult {
	result := &TraceResult{
		Output: output,
		Hops:   []TraceHop{},
	}

	lines := strings.Split(output, "\n")

	// Patterns for parsing
	hopPattern := regexp.MustCompile(`^\s*(\d+)\. (\w+): ([^,]+)(?:, priority (\d+))?`)
	dropPattern := regexp.MustCompile(`(?i)(drop|reject)`)

	var currentHop *TraceHop

	for _, line := range lines {
		// Check for hop line
		if matches := hopPattern.FindStringSubmatch(line); matches != nil {
			if currentHop != nil {
				result.Hops = append(result.Hops, *currentHop)
			}

			priority := 0
			if len(matches) > 4 && matches[4] != "" {
				fmt.Sscanf(matches[4], "%d", &priority)
			}

			currentHop = &TraceHop{
				Pipeline:  matches[2],
				TableName: matches[3],
				Priority:  priority,
			}

			// Check for drop
			if dropPattern.MatchString(line) {
				currentHop.IsDrop = true
				result.Dropped = true
				result.DropReason = line
			}
		}

		// Check for action lines
		if currentHop != nil && strings.HasPrefix(line, "    ") {
			action := strings.TrimSpace(line)
			if currentHop.Actions != "" {
				currentHop.Actions += "; "
			}
			currentHop.Actions += action

			// Check verdict indicators
			if strings.Contains(strings.ToLower(action), "drop") {
				result.Dropped = true
				result.Verdict = "drop"
			} else if strings.Contains(action, "output") {
				result.Verdict = "output"
			} else if strings.Contains(action, "ct_commit") {
				if result.Verdict == "" {
					result.Verdict = "ct_commit"
				}
			}
		}
	}

	// Add final hop
	if currentHop != nil {
		result.Hops = append(result.Hops, *currentHop)
	}

	// Set default verdict if not determined
	if result.Verdict == "" {
		if result.Dropped {
			result.Verdict = "drop"
		} else {
			result.Verdict = "allow"
		}
	}

	return result
}

// =============================================================================
// REST HANDLER
// =============================================================================

// TracePacketREST handles REST API requests for packet tracing.
// This can be registered with your HTTP router.
type TracePacketRESTRequest struct {
	InPort   string `json:"in_port"`
	EthSrc   string `json:"eth_src,omitempty"`
	EthDst   string `json:"eth_dst,omitempty"`
	IPSrc    string `json:"ip_src"`
	IPDst    string `json:"ip_dst"`
	Protocol string `json:"protocol,omitempty"`
	SrcPort  int    `json:"src_port,omitempty"`
	DstPort  int    `json:"dst_port,omitempty"`
	Datapath string `json:"datapath,omitempty"`
}

type TracePacketRESTResponse struct {
	Output     string         `json:"output"`
	Hops       []TraceHopJSON `json:"hops"`
	Verdict    string         `json:"verdict"`
	DropReason string         `json:"drop_reason,omitempty"`
	Dropped    bool           `json:"dropped"`
	DurationMs int64          `json:"duration_ms"`
	Timestamp  string         `json:"timestamp"`
}

type TraceHopJSON struct {
	Datapath  string `json:"datapath,omitempty"`
	Pipeline  string `json:"pipeline"`
	Table     int    `json:"table"`
	TableName string `json:"table_name"`
	Priority  int    `json:"priority"`
	Match     string `json:"match,omitempty"`
	Actions   string `json:"actions"`
	IsDrop    bool   `json:"is_drop"`
}

// HandleTracePacketREST handles REST API packet trace requests.
func (s *PacketTraceService) HandleTracePacketREST(ctx context.Context, req TracePacketRESTRequest) (*TracePacketRESTResponse, error) {
	traceReq := TraceRequest{
		InPort:   req.InPort,
		EthSrc:   req.EthSrc,
		EthDst:   req.EthDst,
		IPSrc:    req.IPSrc,
		IPDst:    req.IPDst,
		Protocol: req.Protocol,
		SrcPort:  req.SrcPort,
		DstPort:  req.DstPort,
		Datapath: req.Datapath,
	}

	result, err := s.TracePacket(ctx, traceReq)
	if err != nil {
		return nil, err
	}

	hops := make([]TraceHopJSON, len(result.Hops))
	for i, hop := range result.Hops {
		hops[i] = TraceHopJSON{
			Datapath:  hop.Datapath,
			Pipeline:  hop.Pipeline,
			Table:     hop.Table,
			TableName: hop.TableName,
			Priority:  hop.Priority,
			Match:     hop.Match,
			Actions:   hop.Actions,
			IsDrop:    hop.IsDrop,
		}
	}

	return &TracePacketRESTResponse{
		Output:     result.Output,
		Hops:       hops,
		Verdict:    result.Verdict,
		DropReason: result.DropReason,
		Dropped:    result.Dropped,
		DurationMs: result.Duration.Milliseconds(),
		Timestamp:  result.Timestamp.Format(time.RFC3339),
	}, nil
}
