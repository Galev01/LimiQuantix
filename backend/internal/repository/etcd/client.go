// Package etcd provides etcd client functionality for distributed coordination.
package etcd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	clientv3 "go.etcd.io/etcd/client/v3"
	"go.etcd.io/etcd/client/v3/concurrency"
	"go.uber.org/zap"

	"github.com/Quantixkvm/Quantixkvm/internal/config"
)

// ErrKeyNotFound indicates the key was not found in etcd.
var ErrKeyNotFound = errors.New("key not found")

// Client wraps an etcd client with leader election and distributed locking.
type Client struct {
	client  *clientv3.Client
	session *concurrency.Session
	logger  *zap.Logger
}

// NewClient creates a new etcd client.
func NewClient(cfg config.EtcdConfig, logger *zap.Logger) (*Client, error) {
	client, err := clientv3.New(clientv3.Config{
		Endpoints:   cfg.Endpoints,
		DialTimeout: cfg.DialTimeout,
		Username:    cfg.Username,
		Password:    cfg.Password,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to etcd: %w", err)
	}

	// Create a session for distributed coordination
	session, err := concurrency.NewSession(client, concurrency.WithTTL(30))
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create etcd session: %w", err)
	}

	logger.Info("Connected to etcd", zap.Strings("endpoints", cfg.Endpoints))

	return &Client{
		client:  client,
		session: session,
		logger:  logger,
	}, nil
}

// Close closes the etcd client and session.
func (c *Client) Close() error {
	if c.session != nil {
		c.session.Close()
	}
	return c.client.Close()
}

// Health checks if etcd is reachable.
func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	_, err := c.client.Status(ctx, c.client.Endpoints()[0])
	return err
}

// =============================================================================
// Key-Value Operations
// =============================================================================

// Put stores a value in etcd.
func (c *Client) Put(ctx context.Context, key string, value interface{}) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}

	_, err = c.client.Put(ctx, key, string(data))
	if err != nil {
		return fmt.Errorf("failed to put key: %w", err)
	}

	return nil
}

// Get retrieves a value from etcd.
func (c *Client) Get(ctx context.Context, key string, dest interface{}) error {
	resp, err := c.client.Get(ctx, key)
	if err != nil {
		return fmt.Errorf("failed to get key: %w", err)
	}

	if len(resp.Kvs) == 0 {
		return ErrKeyNotFound
	}

	return json.Unmarshal(resp.Kvs[0].Value, dest)
}

// Delete removes a key from etcd.
func (c *Client) Delete(ctx context.Context, key string) error {
	_, err := c.client.Delete(ctx, key)
	return err
}

// List returns all values with a given key prefix.
func (c *Client) List(ctx context.Context, prefix string, dest interface{}) error {
	resp, err := c.client.Get(ctx, prefix, clientv3.WithPrefix())
	if err != nil {
		return fmt.Errorf("failed to list keys: %w", err)
	}

	// Collect values into a slice of raw messages
	var values []json.RawMessage
	for _, kv := range resp.Kvs {
		values = append(values, json.RawMessage(kv.Value))
	}

	data, err := json.Marshal(values)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, dest)
}

// =============================================================================
// Watch Operations
// =============================================================================

// WatchEvent represents an etcd watch event.
type WatchEvent struct {
	Type  EventType
	Key   string
	Value []byte
}

// EventType represents the type of watch event.
type EventType string

const (
	EventTypePut    EventType = "PUT"
	EventTypeDelete EventType = "DELETE"
)

// Watch watches for changes on a key or prefix.
func (c *Client) Watch(ctx context.Context, key string, prefix bool) <-chan WatchEvent {
	events := make(chan WatchEvent, 10)

	opts := []clientv3.OpOption{}
	if prefix {
		opts = append(opts, clientv3.WithPrefix())
	}

	go func() {
		defer close(events)

		watchCh := c.client.Watch(ctx, key, opts...)
		for {
			select {
			case <-ctx.Done():
				return
			case resp, ok := <-watchCh:
				if !ok {
					return
				}
				for _, ev := range resp.Events {
					eventType := EventTypePut
					if ev.Type == clientv3.EventTypeDelete {
						eventType = EventTypeDelete
					}
					events <- WatchEvent{
						Type:  eventType,
						Key:   string(ev.Kv.Key),
						Value: ev.Kv.Value,
					}
				}
			}
		}
	}()

	return events
}

// =============================================================================
// Distributed Locking
// =============================================================================

// Lock represents a distributed lock.
type Lock struct {
	mutex *concurrency.Mutex
}

// AcquireLock acquires a distributed lock.
func (c *Client) AcquireLock(ctx context.Context, key string) (*Lock, error) {
	mutex := concurrency.NewMutex(c.session, fmt.Sprintf("/locks/%s", key))

	if err := mutex.Lock(ctx); err != nil {
		return nil, fmt.Errorf("failed to acquire lock: %w", err)
	}

	c.logger.Debug("Acquired lock", zap.String("key", key))

	return &Lock{mutex: mutex}, nil
}

// TryAcquireLock tries to acquire a lock with a timeout.
func (c *Client) TryAcquireLock(ctx context.Context, key string, timeout time.Duration) (*Lock, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	return c.AcquireLock(ctx, key)
}

// Unlock releases a distributed lock.
func (l *Lock) Unlock(ctx context.Context) error {
	if l.mutex == nil {
		return nil
	}
	return l.mutex.Unlock(ctx)
}

// =============================================================================
// Leader Election
// =============================================================================

// Leader represents a leader election participant.
type Leader struct {
	election *concurrency.Election
	client   *Client
	name     string
	isLeader bool
}

// LeaderCallback is called when leadership status changes.
type LeaderCallback func(isLeader bool)

// CampaignForLeader starts a leader election campaign.
func (c *Client) CampaignForLeader(ctx context.Context, name string, callback LeaderCallback) (*Leader, error) {
	election := concurrency.NewElection(c.session, fmt.Sprintf("/leaders/%s", name))

	leader := &Leader{
		election: election,
		client:   c,
		name:     name,
		isLeader: false,
	}

	// Start campaign in background
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
				if err := election.Campaign(ctx, fmt.Sprintf("%d", c.session.Lease())); err != nil {
					if ctx.Err() != nil {
						return
					}
					c.logger.Warn("Leader campaign failed, retrying", zap.Error(err))
					time.Sleep(5 * time.Second)
					continue
				}

				// We became the leader
				leader.isLeader = true
				c.logger.Info("Became leader", zap.String("name", name))
				if callback != nil {
					callback(true)
				}

				// Wait until we lose leadership
				select {
				case <-ctx.Done():
					return
				case <-c.session.Done():
					leader.isLeader = false
					c.logger.Info("Lost leadership", zap.String("name", name))
					if callback != nil {
						callback(false)
					}
					return
				}
			}
		}
	}()

	return leader, nil
}

// IsLeader returns true if this instance is currently the leader.
func (l *Leader) IsLeader() bool {
	return l.isLeader
}

// Resign resigns from leadership.
func (l *Leader) Resign(ctx context.Context) error {
	if l.election == nil || !l.isLeader {
		return nil
	}

	if err := l.election.Resign(ctx); err != nil {
		return fmt.Errorf("failed to resign: %w", err)
	}

	l.isLeader = false
	l.client.logger.Info("Resigned from leadership", zap.String("name", l.name))
	return nil
}

// GetLeader returns the current leader's value.
func (c *Client) GetLeader(ctx context.Context, name string) (string, error) {
	election := concurrency.NewElection(c.session, fmt.Sprintf("/leaders/%s", name))

	resp, err := election.Leader(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get leader: %w", err)
	}

	if len(resp.Kvs) == 0 {
		return "", ErrKeyNotFound
	}

	return string(resp.Kvs[0].Value), nil
}

// =============================================================================
// Node State Management
// =============================================================================

// NodeState represents the state of a node in the cluster.
type NodeState struct {
	ID           string    `json:"id"`
	Hostname     string    `json:"hostname"`
	ManagementIP string    `json:"management_ip"`
	Ready        bool      `json:"ready"`
	LastSeen     time.Time `json:"last_seen"`
}

// RegisterNode registers a node in the cluster.
func (c *Client) RegisterNode(ctx context.Context, state NodeState) error {
	state.LastSeen = time.Now()
	key := fmt.Sprintf("/nodes/%s", state.ID)
	return c.Put(ctx, key, state)
}

// UpdateNodeHeartbeat updates a node's last seen time.
func (c *Client) UpdateNodeHeartbeat(ctx context.Context, nodeID string) error {
	key := fmt.Sprintf("/nodes/%s", nodeID)

	var state NodeState
	if err := c.Get(ctx, key, &state); err != nil {
		return err
	}

	state.LastSeen = time.Now()
	return c.Put(ctx, key, state)
}

// GetNodes returns all registered nodes.
func (c *Client) GetNodes(ctx context.Context) ([]NodeState, error) {
	resp, err := c.client.Get(ctx, "/nodes/", clientv3.WithPrefix())
	if err != nil {
		return nil, fmt.Errorf("failed to get nodes: %w", err)
	}

	var nodes []NodeState
	for _, kv := range resp.Kvs {
		var state NodeState
		if err := json.Unmarshal(kv.Value, &state); err != nil {
			c.logger.Warn("Failed to unmarshal node state", zap.Error(err))
			continue
		}
		nodes = append(nodes, state)
	}

	return nodes, nil
}

// DeregisterNode removes a node from the cluster.
func (c *Client) DeregisterNode(ctx context.Context, nodeID string) error {
	key := fmt.Sprintf("/nodes/%s", nodeID)
	return c.Delete(ctx, key)
}
