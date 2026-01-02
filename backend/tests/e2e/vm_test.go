//go:build e2e
// +build e2e

// Package e2e provides end-to-end tests for the Quantixkvm API.
package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"
)

var (
	baseURL     = getEnv("API_URL", "http://localhost:8080")
	accessToken string
)

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// TestMain runs before all tests
func TestMain(m *testing.M) {
	// Wait for server to be ready
	for i := 0; i < 30; i++ {
		resp, err := http.Get(baseURL + "/health")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			break
		}
		time.Sleep(1 * time.Second)
	}

	// Login to get token
	loginResp, err := login("admin", "admin")
	if err != nil {
		fmt.Printf("Failed to login: %v\n", err)
		os.Exit(1)
	}
	accessToken = loginResp.AccessToken

	// Run tests
	code := m.Run()
	os.Exit(code)
}

// =============================================================================
// Helper types and functions
// =============================================================================

type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    string `json:"expires_at"`
}

type VMResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status struct {
		State string `json:"state"`
	} `json:"status"`
}

type ListVMsResponse struct {
	VMs       []VMResponse `json:"vms"`
	Total     int64        `json:"total_count"`
	NextToken string       `json:"next_page_token"`
}

func login(username, password string) (*LoginResponse, error) {
	body := map[string]string{
		"username": username,
		"password": password,
	}
	bodyBytes, _ := json.Marshal(body)

	resp, err := http.Post(
		baseURL+"/Quantixkvm.auth.v1.AuthService/Login",
		"application/json",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("login failed: %s", string(bodyBytes))
	}

	var result LoginResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

func makeRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		bodyBytes, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(bodyBytes)
	}

	req, err := http.NewRequest(method, baseURL+path, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	if accessToken != "" {
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}

	return http.DefaultClient.Do(req)
}

// =============================================================================
// VM E2E Tests
// =============================================================================

func TestVM_ListVMs(t *testing.T) {
	resp, err := makeRequest("POST", "/Quantixkvm.compute.v1.VMService/ListVMs", map[string]interface{}{
		"page_size": 10,
	})
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("Expected 200, got %d: %s", resp.StatusCode, string(body))
	}

	var result ListVMsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	t.Logf("Found %d VMs", len(result.VMs))
}

func TestVM_CreateGetDelete(t *testing.T) {
	// 1. Create VM
	createReq := map[string]interface{}{
		"name":       fmt.Sprintf("e2e-test-vm-%d", time.Now().Unix()),
		"project_id": "00000000-0000-0000-0000-000000000001",
		"spec": map[string]interface{}{
			"cpu": map[string]interface{}{
				"cores":   2,
				"sockets": 1,
				"threads": 1,
			},
			"memory": map[string]interface{}{
				"size_mib": 4096,
			},
		},
	}

	resp, err := makeRequest("POST", "/Quantixkvm.compute.v1.VMService/CreateVM", createReq)
	if err != nil {
		t.Fatalf("CreateVM request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("CreateVM failed with %d: %s", resp.StatusCode, string(body))
	}

	var createdVM VMResponse
	if err := json.NewDecoder(resp.Body).Decode(&createdVM); err != nil {
		t.Fatalf("Failed to decode created VM: %v", err)
	}

	if createdVM.ID == "" {
		t.Fatal("Created VM has no ID")
	}
	t.Logf("Created VM: %s (ID: %s)", createdVM.Name, createdVM.ID)

	// 2. Get VM
	resp, err = makeRequest("POST", "/Quantixkvm.compute.v1.VMService/GetVM", map[string]string{
		"id": createdVM.ID,
	})
	if err != nil {
		t.Fatalf("GetVM request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GetVM failed with %d: %s", resp.StatusCode, string(body))
	}

	var fetchedVM VMResponse
	if err := json.NewDecoder(resp.Body).Decode(&fetchedVM); err != nil {
		t.Fatalf("Failed to decode fetched VM: %v", err)
	}

	if fetchedVM.ID != createdVM.ID {
		t.Errorf("Expected ID %s, got %s", createdVM.ID, fetchedVM.ID)
	}

	// 3. Delete VM
	resp, err = makeRequest("POST", "/Quantixkvm.compute.v1.VMService/DeleteVM", map[string]string{
		"id": createdVM.ID,
	})
	if err != nil {
		t.Fatalf("DeleteVM request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("DeleteVM failed with %d: %s", resp.StatusCode, string(body))
	}

	t.Logf("Deleted VM: %s", createdVM.ID)

	// 4. Verify VM is deleted
	resp, err = makeRequest("POST", "/Quantixkvm.compute.v1.VMService/GetVM", map[string]string{
		"id": createdVM.ID,
	})
	if err != nil {
		t.Fatalf("GetVM (after delete) request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		t.Fatal("Expected VM to be deleted, but GetVM succeeded")
	}
}

func TestVM_StartStop(t *testing.T) {
	// 1. Create VM
	createReq := map[string]interface{}{
		"name":       fmt.Sprintf("e2e-startstop-vm-%d", time.Now().Unix()),
		"project_id": "00000000-0000-0000-0000-000000000001",
		"spec": map[string]interface{}{
			"cpu":    map[string]interface{}{"cores": 1},
			"memory": map[string]interface{}{"size_mib": 1024},
		},
	}

	resp, err := makeRequest("POST", "/Quantixkvm.compute.v1.VMService/CreateVM", createReq)
	if err != nil {
		t.Fatalf("CreateVM failed: %v", err)
	}
	defer resp.Body.Close()

	var createdVM VMResponse
	json.NewDecoder(resp.Body).Decode(&createdVM)
	t.Logf("Created VM: %s", createdVM.ID)

	// Cleanup
	defer func() {
		makeRequest("POST", "/Quantixkvm.compute.v1.VMService/DeleteVM", map[string]string{
			"id": createdVM.ID,
		})
	}()

	// 2. Start VM
	resp, err = makeRequest("POST", "/Quantixkvm.compute.v1.VMService/StartVM", map[string]string{
		"id": createdVM.ID,
	})
	if err != nil {
		t.Fatalf("StartVM failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("StartVM failed with %d: %s", resp.StatusCode, string(body))
	}

	var startedVM VMResponse
	json.NewDecoder(resp.Body).Decode(&startedVM)
	t.Logf("VM state after start: %s", startedVM.Status.State)

	// 3. Stop VM
	resp, err = makeRequest("POST", "/Quantixkvm.compute.v1.VMService/StopVM", map[string]string{
		"id": createdVM.ID,
	})
	if err != nil {
		t.Fatalf("StopVM failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("StopVM failed with %d: %s", resp.StatusCode, string(body))
	}

	var stoppedVM VMResponse
	json.NewDecoder(resp.Body).Decode(&stoppedVM)
	t.Logf("VM state after stop: %s", stoppedVM.Status.State)
}

func TestVM_CreateWithInvalidSpec(t *testing.T) {
	// Try to create VM without required fields
	createReq := map[string]interface{}{
		"name": "invalid-vm",
		// Missing project_id and spec
	}

	resp, err := makeRequest("POST", "/Quantixkvm.compute.v1.VMService/CreateVM", createReq)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should fail with validation error
	if resp.StatusCode == 200 {
		t.Fatal("Expected error for invalid VM spec")
	}

	t.Logf("Got expected error status: %d", resp.StatusCode)
}

// =============================================================================
// Auth E2E Tests
// =============================================================================

func TestAuth_LoginSuccess(t *testing.T) {
	loginResp, err := login("admin", "admin")
	if err != nil {
		t.Fatalf("Login failed: %v", err)
	}

	if loginResp.AccessToken == "" {
		t.Error("Expected access token")
	}

	if loginResp.RefreshToken == "" {
		t.Error("Expected refresh token")
	}

	t.Logf("Login successful, token expires: %s", loginResp.ExpiresAt)
}

func TestAuth_LoginInvalidCredentials(t *testing.T) {
	_, err := login("admin", "wrongpassword")
	if err == nil {
		t.Fatal("Expected error for invalid credentials")
	}

	t.Logf("Got expected error: %v", err)
}

func TestAuth_UnauthenticatedAccess(t *testing.T) {
	// Make request without token
	req, _ := http.NewRequest("POST", baseURL+"/Quantixkvm.compute.v1.VMService/ListVMs", bytes.NewReader([]byte("{}")))
	req.Header.Set("Content-Type", "application/json")
	// No Authorization header

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	// Should get 401
	if resp.StatusCode == 200 {
		t.Fatal("Expected 401 for unauthenticated request")
	}

	t.Logf("Got expected status: %d", resp.StatusCode)
}

// =============================================================================
// Health Check Tests
// =============================================================================

func TestHealth_Endpoint(t *testing.T) {
	resp, err := http.Get(baseURL + "/health")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Health response: %s", string(body))
}

func TestHealth_Ready(t *testing.T) {
	resp, err := http.Get(baseURL + "/ready")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Ready response: %s", string(body))
}

func TestHealth_Live(t *testing.T) {
	resp, err := http.Get(baseURL + "/live")
	if err != nil {
		t.Fatalf("Request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("Expected 200, got %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	t.Logf("Live response: %s", string(body))
}
