// Package memory provides in-memory repository implementations for development.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// SecurityGroupRepository is an in-memory implementation of network.SecurityGroupRepository.
type SecurityGroupRepository struct {
	store sync.Map // map[string]*domain.SecurityGroup
}

// NewSecurityGroupRepository creates a new in-memory security group repository.
func NewSecurityGroupRepository() *SecurityGroupRepository {
	repo := &SecurityGroupRepository{}
	repo.seedData()
	return repo
}

func (r *SecurityGroupRepository) seedData() {
	// Default security group - allows all egress, no ingress
	sg1 := &domain.SecurityGroup{
		ID:          uuid.NewString(),
		Name:        "default",
		Description: "Default security group - allows all egress traffic",
		ProjectID:   "default",
		Labels:      map[string]string{"system": "true"},
		Stateful:    true,
		Rules: []domain.SecurityGroupRule{
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionEgress,
				Protocol:       "any",
				RemoteIPPrefix: "0.0.0.0/0",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow all outbound IPv4",
			},
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionEgress,
				Protocol:       "any",
				RemoteIPPrefix: "::/0",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow all outbound IPv6",
			},
		},
		CreatedAt: time.Now().Add(-30 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-30 * 24 * time.Hour),
	}
	r.store.Store(sg1.ID, sg1)

	// Web server security group
	sg2 := &domain.SecurityGroup{
		ID:          uuid.NewString(),
		Name:        "web-servers",
		Description: "Security group for web servers - allows HTTP/HTTPS",
		ProjectID:   "default",
		Labels:      map[string]string{"app": "web"},
		Stateful:    true,
		Rules: []domain.SecurityGroupRule{
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionIngress,
				Protocol:       "tcp",
				PortMin:        80,
				PortMax:        80,
				RemoteIPPrefix: "0.0.0.0/0",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow HTTP",
			},
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionIngress,
				Protocol:       "tcp",
				PortMin:        443,
				PortMax:        443,
				RemoteIPPrefix: "0.0.0.0/0",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow HTTPS",
			},
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionEgress,
				Protocol:       "any",
				RemoteIPPrefix: "0.0.0.0/0",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow all outbound",
			},
		},
		CreatedAt: time.Now().Add(-14 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-7 * 24 * time.Hour),
	}
	r.store.Store(sg2.ID, sg2)

	// SSH access security group
	sg3 := &domain.SecurityGroup{
		ID:          uuid.NewString(),
		Name:        "ssh-access",
		Description: "Security group for SSH access",
		ProjectID:   "default",
		Labels:      map[string]string{"purpose": "management"},
		Stateful:    true,
		Rules: []domain.SecurityGroupRule{
			{
				ID:             uuid.NewString(),
				Direction:      domain.RuleDirectionIngress,
				Protocol:       "tcp",
				PortMin:        22,
				PortMax:        22,
				RemoteIPPrefix: "10.0.0.0/8",
				Action:         domain.RuleActionAllow,
				Priority:       100,
				Description:    "Allow SSH from internal network",
			},
		},
		CreatedAt: time.Now().Add(-10 * 24 * time.Hour),
		UpdatedAt: time.Now().Add(-5 * 24 * time.Hour),
	}
	r.store.Store(sg3.ID, sg3)
}

// Create adds a new security group to the store.
func (r *SecurityGroupRepository) Create(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error) {
	if sg.ID == "" {
		sg.ID = uuid.NewString()
	}

	// Check name uniqueness within project
	var exists bool
	r.store.Range(func(key, value interface{}) bool {
		existing := value.(*domain.SecurityGroup)
		if existing.ProjectID == sg.ProjectID && existing.Name == sg.Name {
			exists = true
			return false
		}
		return true
	})
	if exists {
		return nil, domain.ErrAlreadyExists
	}

	now := time.Now()
	sg.CreatedAt = now
	sg.UpdatedAt = now
	r.store.Store(sg.ID, sg)
	return sg, nil
}

// Get retrieves a security group by ID.
func (r *SecurityGroupRepository) Get(ctx context.Context, id string) (*domain.SecurityGroup, error) {
	if val, ok := r.store.Load(id); ok {
		return val.(*domain.SecurityGroup), nil
	}
	return nil, domain.ErrNotFound
}

// GetByName retrieves a security group by name within a project.
func (r *SecurityGroupRepository) GetByName(ctx context.Context, projectID, name string) (*domain.SecurityGroup, error) {
	var found *domain.SecurityGroup
	r.store.Range(func(key, value interface{}) bool {
		sg := value.(*domain.SecurityGroup)
		if sg.ProjectID == projectID && sg.Name == name {
			found = sg
			return false
		}
		return true
	})
	if found != nil {
		return found, nil
	}
	return nil, domain.ErrNotFound
}

// List retrieves security groups based on filter criteria.
func (r *SecurityGroupRepository) List(ctx context.Context, projectID string, limit int, offset int) ([]*domain.SecurityGroup, int, error) {
	var result []*domain.SecurityGroup
	var total int

	r.store.Range(func(key, value interface{}) bool {
		sg := value.(*domain.SecurityGroup)

		// Apply filter
		if projectID != "" && sg.ProjectID != projectID {
			return true
		}

		total++
		result = append(result, sg)
		return true
	})

	// Apply pagination
	if offset >= len(result) {
		return []*domain.SecurityGroup{}, total, nil
	}
	end := offset + limit
	if end > len(result) {
		end = len(result)
	}

	return result[offset:end], total, nil
}

// Update modifies an existing security group.
func (r *SecurityGroupRepository) Update(ctx context.Context, sg *domain.SecurityGroup) (*domain.SecurityGroup, error) {
	if _, ok := r.store.Load(sg.ID); !ok {
		return nil, domain.ErrNotFound
	}
	sg.UpdatedAt = time.Now()
	r.store.Store(sg.ID, sg)
	return sg, nil
}

// Delete removes a security group by ID.
func (r *SecurityGroupRepository) Delete(ctx context.Context, id string) error {
	if _, ok := r.store.Load(id); !ok {
		return domain.ErrNotFound
	}
	r.store.Delete(id)
	return nil
}
