// Package redis provides Redis caching and pub/sub functionality.
package redis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/Quantixkvm/Quantixkvm/internal/config"
	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// ErrCacheMiss indicates the key was not found in cache.
var ErrCacheMiss = errors.New("cache miss")

// Cache wraps a Redis client for caching operations.
type Cache struct {
	client *redis.Client
	logger *zap.Logger
}

// NewCache creates a new Redis cache connection.
func NewCache(cfg config.RedisConfig, logger *zap.Logger) (*Cache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Address(),
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("failed to connect to Redis: %w", err)
	}

	logger.Info("Connected to Redis", zap.String("addr", cfg.Address()))

	return &Cache{client: client, logger: logger}, nil
}

// Close closes the Redis connection.
func (c *Cache) Close() error {
	return c.client.Close()
}

// Health checks if Redis is reachable.
func (c *Cache) Health(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// =============================================================================
// Generic Cache Operations
// =============================================================================

// Get retrieves a value from cache and unmarshals it into dest.
func (c *Cache) Get(ctx context.Context, key string, dest interface{}) error {
	val, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return ErrCacheMiss
	}
	if err != nil {
		return fmt.Errorf("redis get error: %w", err)
	}

	return json.Unmarshal([]byte(val), dest)
}

// Set stores a value in cache with a TTL.
func (c *Cache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to marshal value: %w", err)
	}

	return c.client.Set(ctx, key, data, ttl).Err()
}

// Delete removes a key from cache.
func (c *Cache) Delete(ctx context.Context, key string) error {
	return c.client.Del(ctx, key).Err()
}

// DeletePattern removes all keys matching a pattern.
func (c *Cache) DeletePattern(ctx context.Context, pattern string) error {
	iter := c.client.Scan(ctx, 0, pattern, 100).Iterator()
	for iter.Next(ctx) {
		if err := c.client.Del(ctx, iter.Val()).Err(); err != nil {
			c.logger.Warn("Failed to delete key", zap.String("key", iter.Val()), zap.Error(err))
		}
	}
	return iter.Err()
}

// =============================================================================
// VM Cache Operations
// =============================================================================

const vmCacheTTL = 5 * time.Minute

// GetVM retrieves a VM from cache.
func (c *Cache) GetVM(ctx context.Context, id string) (*domain.VirtualMachine, error) {
	key := fmt.Sprintf("vm:%s", id)
	var vm domain.VirtualMachine
	if err := c.Get(ctx, key, &vm); err != nil {
		return nil, err
	}
	return &vm, nil
}

// SetVM stores a VM in cache.
func (c *Cache) SetVM(ctx context.Context, vm *domain.VirtualMachine) error {
	key := fmt.Sprintf("vm:%s", vm.ID)
	return c.Set(ctx, key, vm, vmCacheTTL)
}

// InvalidateVM removes a VM from cache.
func (c *Cache) InvalidateVM(ctx context.Context, id string) error {
	key := fmt.Sprintf("vm:%s", id)
	return c.Delete(ctx, key)
}

// InvalidateVMsByProject invalidates all VMs in a project.
func (c *Cache) InvalidateVMsByProject(ctx context.Context, projectID string) error {
	return c.DeletePattern(ctx, fmt.Sprintf("vm:*:project:%s", projectID))
}

// =============================================================================
// Node Cache Operations
// =============================================================================

const nodeCacheTTL = 1 * time.Minute // Shorter TTL for node status

// GetNode retrieves a node from cache.
func (c *Cache) GetNode(ctx context.Context, id string) (*domain.Node, error) {
	key := fmt.Sprintf("node:%s", id)
	var node domain.Node
	if err := c.Get(ctx, key, &node); err != nil {
		return nil, err
	}
	return &node, nil
}

// SetNode stores a node in cache.
func (c *Cache) SetNode(ctx context.Context, node *domain.Node) error {
	key := fmt.Sprintf("node:%s", node.ID)
	return c.Set(ctx, key, node, nodeCacheTTL)
}

// InvalidateNode removes a node from cache.
func (c *Cache) InvalidateNode(ctx context.Context, id string) error {
	key := fmt.Sprintf("node:%s", id)
	return c.Delete(ctx, key)
}

// =============================================================================
// Pub/Sub Operations for Real-time Updates
// =============================================================================

// Event represents a real-time event.
type Event struct {
	Type       string      `json:"type"` // "vm.created", "vm.started", "node.updated", etc.
	ResourceID string      `json:"resource_id"`
	Data       interface{} `json:"data,omitempty"`
	Timestamp  time.Time   `json:"timestamp"`
}

// Publish publishes an event to a channel.
func (c *Cache) Publish(ctx context.Context, channel string, event Event) error {
	event.Timestamp = time.Now()
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}
	return c.client.Publish(ctx, channel, data).Err()
}

// Subscribe subscribes to a channel and returns a message channel.
func (c *Cache) Subscribe(ctx context.Context, channels ...string) <-chan Event {
	pubsub := c.client.Subscribe(ctx, channels...)
	events := make(chan Event, 100)

	go func() {
		defer close(events)
		defer pubsub.Close()

		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-pubsub.Channel():
				var event Event
				if err := json.Unmarshal([]byte(msg.Payload), &event); err != nil {
					c.logger.Warn("Failed to unmarshal event", zap.Error(err))
					continue
				}
				events <- event
			}
		}
	}()

	return events
}

// PublishVMEvent publishes a VM-related event.
func (c *Cache) PublishVMEvent(ctx context.Context, eventType string, vm *domain.VirtualMachine) error {
	return c.Publish(ctx, "events:vm", Event{
		Type:       eventType,
		ResourceID: vm.ID,
		Data:       vm,
	})
}

// PublishNodeEvent publishes a node-related event.
func (c *Cache) PublishNodeEvent(ctx context.Context, eventType string, node *domain.Node) error {
	return c.Publish(ctx, "events:node", Event{
		Type:       eventType,
		ResourceID: node.ID,
		Data:       node,
	})
}

// =============================================================================
// Session/Token Storage
// =============================================================================

const sessionTTL = 24 * time.Hour

// SetSession stores a user session.
func (c *Cache) SetSession(ctx context.Context, sessionID string, userID string) error {
	key := fmt.Sprintf("session:%s", sessionID)
	return c.client.Set(ctx, key, userID, sessionTTL).Err()
}

// GetSession retrieves a user session.
func (c *Cache) GetSession(ctx context.Context, sessionID string) (string, error) {
	key := fmt.Sprintf("session:%s", sessionID)
	userID, err := c.client.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", ErrCacheMiss
	}
	return userID, err
}

// DeleteSession removes a user session.
func (c *Cache) DeleteSession(ctx context.Context, sessionID string) error {
	key := fmt.Sprintf("session:%s", sessionID)
	return c.client.Del(ctx, key).Err()
}

// =============================================================================
// Rate Limiting
// =============================================================================

// RateLimitResult contains the result of a rate limit check.
type RateLimitResult struct {
	Allowed   bool
	Remaining int64
	ResetAt   time.Time
}

// CheckRateLimit checks if a request is within rate limits.
// Uses a sliding window algorithm.
func (c *Cache) CheckRateLimit(ctx context.Context, key string, limit int64, window time.Duration) (*RateLimitResult, error) {
	now := time.Now()
	windowStart := now.Add(-window)

	pipe := c.client.Pipeline()

	// Remove old entries
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", windowStart.UnixNano()))

	// Count current entries
	countCmd := pipe.ZCard(ctx, key)

	// Add current request
	pipe.ZAdd(ctx, key, redis.Z{
		Score:  float64(now.UnixNano()),
		Member: now.UnixNano(),
	})

	// Set expiry
	pipe.Expire(ctx, key, window)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("rate limit check failed: %w", err)
	}

	count := countCmd.Val()
	allowed := count < limit
	remaining := limit - count - 1
	if remaining < 0 {
		remaining = 0
	}

	return &RateLimitResult{
		Allowed:   allowed,
		Remaining: remaining,
		ResetAt:   now.Add(window),
	}, nil
}
