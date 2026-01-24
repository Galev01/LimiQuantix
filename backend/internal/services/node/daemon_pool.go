// Package node provides services for managing hypervisor nodes.
// This file contains the Node Daemon connection pool.
package node

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
)

// OnConnectCallback is called when a node connects or reconnects.
// It receives the node ID and can be used to sync state to the node.
type OnConnectCallback func(ctx context.Context, nodeID string) error

// DaemonPool manages connections to multiple node daemons.
// It provides thread-safe access to node daemon clients with automatic
// connection recovery.
type DaemonPool struct {
	clients     map[string]*DaemonClient
	mu          sync.RWMutex
	logger      *zap.Logger
	onConnect   OnConnectCallback
	onConnectMu sync.RWMutex
}

// NewDaemonPool creates a new daemon pool.
func NewDaemonPool(logger *zap.Logger) *DaemonPool {
	return &DaemonPool{
		clients: make(map[string]*DaemonClient),
		logger:  logger,
	}
}

// SetOnConnectCallback sets a callback that is invoked when a node connects or reconnects.
// This is useful for syncing state (like storage pools) to newly connected nodes.
func (p *DaemonPool) SetOnConnectCallback(cb OnConnectCallback) {
	p.onConnectMu.Lock()
	defer p.onConnectMu.Unlock()
	p.onConnect = cb
}

// Connect establishes a connection to a node daemon.
// If a connection already exists, it returns the existing client.
func (p *DaemonPool) Connect(nodeID, addr string) (*DaemonClient, error) {
	p.mu.Lock()
	
	isNewConnection := false

	// Check if we already have a connection
	if client, ok := p.clients[nodeID]; ok {
		// Verify the connection is still healthy
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := client.HealthCheck(ctx)
		cancel()
		
		if err == nil {
			p.mu.Unlock()
			return client, nil
		}

		// Connection is stale, close it
		p.logger.Warn("Stale connection to node daemon, reconnecting",
			zap.String("node_id", nodeID),
			zap.String("addr", addr),
		)
		client.Close()
		delete(p.clients, nodeID)
		isNewConnection = true
	} else {
		isNewConnection = true
	}

	// Create a new connection
	client, err := NewDaemonClient(addr, p.logger)
	if err != nil {
		p.mu.Unlock()
		return nil, err
	}

	p.clients[nodeID] = client
	p.mu.Unlock()

	// Call the onConnect callback for new connections (outside the lock)
	if isNewConnection {
		p.onConnectMu.RLock()
		cb := p.onConnect
		p.onConnectMu.RUnlock()
		
		if cb != nil {
			// Run callback in background to not block the connection
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				
				p.logger.Info("Running onConnect callback for node",
					zap.String("node_id", nodeID),
				)
				
				if err := cb(ctx, nodeID); err != nil {
					p.logger.Warn("onConnect callback failed",
						zap.String("node_id", nodeID),
						zap.Error(err),
					)
				} else {
					p.logger.Info("onConnect callback completed successfully",
						zap.String("node_id", nodeID),
					)
				}
			}()
		}
	}

	return client, nil
}

// Get retrieves a client for a specific node.
// Returns nil if no connection exists.
func (p *DaemonPool) Get(nodeID string) *DaemonClient {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.clients[nodeID]
}

// GetOrError retrieves a client for a specific node.
// Returns an error if no connection exists.
func (p *DaemonPool) GetOrError(nodeID string) (*DaemonClient, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	client, ok := p.clients[nodeID]
	if !ok {
		return nil, fmt.Errorf("no connection to node %s", nodeID)
	}
	return client, nil
}

// GetNodeAddr returns the HTTP address of a connected node.
// The address is returned in format "host:8080" for HTTP API access.
// Note: The Node Daemon runs HTTP on 8080 by default. HTTPS on 8443 is optional.
func (p *DaemonPool) GetNodeAddr(nodeID string) (string, error) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	client, ok := p.clients[nodeID]
	if !ok {
		return "", fmt.Errorf("no connection to node %s", nodeID)
	}

	// Convert gRPC port (9090) to HTTP port (8080)
	// Note: HTTPS on 8443 is disabled by default on the node daemon
	addr := client.Addr()
	// Replace :9090 with :8080 for HTTP API
	if len(addr) > 5 && addr[len(addr)-5:] == ":9090" {
		addr = addr[:len(addr)-5] + ":8080"
	}

	return addr, nil
}

// Disconnect closes the connection to a node daemon.
func (p *DaemonPool) Disconnect(nodeID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	client, ok := p.clients[nodeID]
	if !ok {
		return nil
	}

	err := client.Close()
	delete(p.clients, nodeID)

	p.logger.Info("Disconnected from node daemon",
		zap.String("node_id", nodeID),
	)

	return err
}

// Close closes all connections in the pool.
func (p *DaemonPool) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var lastErr error
	for nodeID, client := range p.clients {
		if err := client.Close(); err != nil {
			p.logger.Error("Error closing connection",
				zap.String("node_id", nodeID),
				zap.Error(err),
			)
			lastErr = err
		}
	}

	p.clients = make(map[string]*DaemonClient)
	return lastErr
}

// ConnectedNodes returns a list of connected node IDs.
func (p *DaemonPool) ConnectedNodes() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	nodes := make([]string, 0, len(p.clients))
	for nodeID := range p.clients {
		nodes = append(nodes, nodeID)
	}
	return nodes
}

// HealthCheckAll performs a health check on all connected nodes.
// Returns a map of node ID to health status.
func (p *DaemonPool) HealthCheckAll(ctx context.Context) map[string]bool {
	p.mu.RLock()
	nodes := make(map[string]*DaemonClient)
	for k, v := range p.clients {
		nodes[k] = v
	}
	p.mu.RUnlock()

	results := make(map[string]bool)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for nodeID, client := range nodes {
		wg.Add(1)
		go func(nodeID string, client *DaemonClient) {
			defer wg.Done()

			checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			resp, err := client.HealthCheck(checkCtx)
			healthy := err == nil && resp != nil && resp.Healthy

			mu.Lock()
			results[nodeID] = healthy
			mu.Unlock()
		}(nodeID, client)
	}

	wg.Wait()
	return results
}
