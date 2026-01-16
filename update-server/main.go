// Package main implements the Quantix Update Server.
// This server provides OTA (Over-The-Air) updates for Quantix-OS and Quantix-vDC.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"go.uber.org/zap"
)

// Component represents an individual updatable component
type Component struct {
	Name           string `json:"name"`
	Version        string `json:"version"`
	Artifact       string `json:"artifact"`
	SHA256         string `json:"sha256"`
	SizeBytes      int64  `json:"size_bytes"`
	InstallPath    string `json:"install_path"`
	RestartService string `json:"restart_service,omitempty"`
}

// FullImage represents a full system image for A/B updates
type FullImage struct {
	Artifact       string `json:"artifact"`
	SHA256         string `json:"sha256"`
	SizeBytes      int64  `json:"size_bytes"`
	RequiresReboot bool   `json:"requires_reboot"`
}

// Manifest represents an update manifest
type Manifest struct {
	Product      string      `json:"product"`
	Version      string      `json:"version"`
	Channel      string      `json:"channel"`
	ReleaseDate  time.Time   `json:"release_date"`
	UpdateType   string      `json:"update_type"` // "component" or "full"
	Components   []Component `json:"components"`
	FullImage    *FullImage  `json:"full_image,omitempty"`
	MinVersion   string      `json:"min_version"`
	ReleaseNotes string      `json:"release_notes"`
}

// Channel represents an update channel
type Channel struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ReleaseInfo provides summary information about a release
type ReleaseInfo struct {
	Version     string    `json:"version"`
	Channel     string    `json:"channel"`
	ReleaseDate time.Time `json:"release_date"`
	UpdateType  string    `json:"update_type"`
}

// Config holds the server configuration
type Config struct {
	ReleaseDir   string
	ListenAddr   string
	PublishToken string
}

var (
	log    *zap.Logger
	config Config
)

func main() {
	// Initialize logger
	var err error
	log, err = zap.NewProduction()
	if err != nil {
		panic(fmt.Sprintf("Failed to initialize logger: %v", err))
	}
	defer log.Sync()

	// Load configuration from environment
	config = Config{
		ReleaseDir:   getEnv("RELEASE_DIR", "/data/releases"),
		ListenAddr:   getEnv("LISTEN_ADDR", "0.0.0.0:9000"),
		PublishToken: getEnv("PUBLISH_TOKEN", "dev-token"),
	}

	// Create release directories if they don't exist
	products := []string{"quantix-os", "quantix-vdc"}
	channels := []string{"dev", "beta", "stable"}
	for _, product := range products {
		for _, channel := range channels {
			dir := filepath.Join(config.ReleaseDir, product, channel)
			if err := os.MkdirAll(dir, 0755); err != nil {
				log.Fatal("Failed to create release directory", zap.String("dir", dir), zap.Error(err))
			}
		}
	}

	log.Info("Starting Quantix Update Server",
		zap.String("release_dir", config.ReleaseDir),
		zap.String("listen_addr", config.ListenAddr),
	)

	// Create Fiber app
	app := fiber.New(fiber.Config{
		AppName:       "Quantix Update Server",
		BodyLimit:     1024 * 1024 * 1024, // 1GB max for squashfs uploads
		ServerHeader:  "Quantix-Update-Server",
		StrictRouting: false,
	})

	// Middleware
	app.Use(logger.New(logger.Config{
		Format:     "${time} | ${status} | ${latency} | ${ip} | ${method} | ${path}\n",
		TimeFormat: "2006-01-02 15:04:05",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,HEAD,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept,Authorization",
	}))

	// Health check
	app.Get("/health", handleHealth)

	// API routes
	api := app.Group("/api/v1")

	// Channel management
	api.Get("/channels", handleListChannels)

	// Product-specific routes
	api.Get("/:product/manifest", handleGetLatestManifest)
	api.Get("/:product/releases", handleListReleases)
	api.Get("/:product/releases/:version/manifest", handleGetManifest)
	api.Get("/:product/releases/:version/:artifact", handleDownloadArtifact)

	// Publish endpoint (authenticated)
	api.Post("/:product/publish", authMiddleware, handlePublish)

	// Start server
	if err := app.Listen(config.ListenAddr); err != nil {
		log.Fatal("Server failed", zap.Error(err))
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// authMiddleware checks for valid authentication token
func authMiddleware(c *fiber.Ctx) error {
	token := c.Get("Authorization")
	if token == "" {
		token = c.Query("token")
	}

	// Remove "Bearer " prefix if present
	token = strings.TrimPrefix(token, "Bearer ")

	if token != config.PublishToken {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{
			"error": "Invalid or missing authentication token",
		})
	}

	return c.Next()
}

// handleHealth returns server health status
func handleHealth(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"status":    "healthy",
		"timestamp": time.Now().UTC(),
	})
}

// handleListChannels returns available update channels
func handleListChannels(c *fiber.Ctx) error {
	channels := []Channel{
		{Name: "dev", Description: "Development builds - latest features, may be unstable"},
		{Name: "beta", Description: "Beta builds - feature complete, testing phase"},
		{Name: "stable", Description: "Stable builds - production ready"},
	}
	return c.JSON(channels)
}

// handleGetLatestManifest returns the latest manifest for a product
func handleGetLatestManifest(c *fiber.Ctx) error {
	product := c.Params("product")
	channel := c.Query("channel", "dev")

	if !isValidProduct(product) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product. Must be 'quantix-os' or 'quantix-vdc'",
		})
	}

	// Find latest version in channel
	channelDir := filepath.Join(config.ReleaseDir, product, channel)
	versions, err := listVersions(channelDir)
	if err != nil || len(versions) == 0 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error":   "No releases found",
			"product": product,
			"channel": channel,
		})
	}

	// Get the latest version (versions are sorted descending)
	latestVersion := versions[0]

	return getManifest(c, product, channel, latestVersion)
}

// handleListReleases returns all releases for a product
func handleListReleases(c *fiber.Ctx) error {
	product := c.Params("product")
	channel := c.Query("channel", "")

	if !isValidProduct(product) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product",
		})
	}

	var releases []ReleaseInfo
	channels := []string{"dev", "beta", "stable"}
	if channel != "" {
		channels = []string{channel}
	}

	for _, ch := range channels {
		channelDir := filepath.Join(config.ReleaseDir, product, ch)
		versions, err := listVersions(channelDir)
		if err != nil {
			continue
		}

		for _, version := range versions {
			manifestPath := filepath.Join(channelDir, version, "manifest.json")
			manifest, err := loadManifest(manifestPath)
			if err != nil {
				continue
			}
			releases = append(releases, ReleaseInfo{
				Version:     manifest.Version,
				Channel:     manifest.Channel,
				ReleaseDate: manifest.ReleaseDate,
				UpdateType:  manifest.UpdateType,
			})
		}
	}

	return c.JSON(releases)
}

// handleGetManifest returns a specific version manifest
func handleGetManifest(c *fiber.Ctx) error {
	product := c.Params("product")
	version := c.Params("version")
	channel := c.Query("channel", "dev")

	if !isValidProduct(product) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product",
		})
	}

	return getManifest(c, product, channel, version)
}

func getManifest(c *fiber.Ctx, product, channel, version string) error {
	manifestPath := filepath.Join(config.ReleaseDir, product, channel, version, "manifest.json")

	manifest, err := loadManifest(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error":   "Release not found",
				"product": product,
				"channel": channel,
				"version": version,
			})
		}
		log.Error("Failed to load manifest", zap.Error(err), zap.String("path", manifestPath))
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to load manifest",
		})
	}

	return c.JSON(manifest)
}

// handleDownloadArtifact serves artifact files
func handleDownloadArtifact(c *fiber.Ctx) error {
	product := c.Params("product")
	version := c.Params("version")
	artifact := c.Params("artifact")
	channel := c.Query("channel", "dev")

	if !isValidProduct(product) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product",
		})
	}

	// Sanitize artifact name to prevent path traversal
	artifact = filepath.Base(artifact)
	artifactPath := filepath.Join(config.ReleaseDir, product, channel, version, artifact)

	// Check if file exists
	info, err := os.Stat(artifactPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error":    "Artifact not found",
				"artifact": artifact,
			})
		}
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to access artifact",
		})
	}

	// Set headers for download
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", artifact))
	c.Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	// Determine content type
	contentType := "application/octet-stream"
	switch {
	case strings.HasSuffix(artifact, ".json"):
		contentType = "application/json"
	case strings.HasSuffix(artifact, ".tar.zst"):
		contentType = "application/zstd"
	case strings.HasSuffix(artifact, ".squashfs"):
		contentType = "application/octet-stream"
	}
	c.Set("Content-Type", contentType)

	return c.SendFile(artifactPath)
}

// handlePublish handles new release uploads
func handlePublish(c *fiber.Ctx) error {
	product := c.Params("product")

	if !isValidProduct(product) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product",
		})
	}

	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid multipart form",
		})
	}

	// Get manifest from form
	manifestFiles := form.File["manifest"]
	if len(manifestFiles) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing manifest file",
		})
	}

	// Read and parse manifest
	manifestFile, err := manifestFiles[0].Open()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read manifest",
		})
	}
	defer manifestFile.Close()

	manifestData, err := io.ReadAll(manifestFile)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read manifest data",
		})
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error":   "Invalid manifest JSON",
			"details": err.Error(),
		})
	}

	// Validate manifest
	if manifest.Product != product {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("Manifest product '%s' does not match URL product '%s'", manifest.Product, product),
		})
	}

	if manifest.Version == "" || manifest.Channel == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Manifest must include version and channel",
		})
	}

	// Create release directory
	releaseDir := filepath.Join(config.ReleaseDir, product, manifest.Channel, manifest.Version)
	if err := os.MkdirAll(releaseDir, 0755); err != nil {
		log.Error("Failed to create release directory", zap.Error(err))
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create release directory",
		})
	}

	// Save manifest
	manifestPath := filepath.Join(releaseDir, "manifest.json")
	if err := os.WriteFile(manifestPath, manifestData, 0644); err != nil {
		log.Error("Failed to write manifest", zap.Error(err))
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save manifest",
		})
	}

	// Process component artifacts
	savedArtifacts := []string{"manifest.json"}
	for _, component := range manifest.Components {
		files := form.File[component.Name]
		if len(files) == 0 {
			// Try artifact name as form field
			files = form.File[component.Artifact]
		}
		if len(files) == 0 {
			log.Warn("Missing artifact for component", zap.String("component", component.Name))
			continue
		}

		artifactPath := filepath.Join(releaseDir, component.Artifact)
		if err := saveUploadedFile(files[0], artifactPath); err != nil {
			log.Error("Failed to save artifact", zap.Error(err), zap.String("component", component.Name))
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"error":     "Failed to save artifact",
				"component": component.Name,
			})
		}

		// Verify SHA256 if provided
		if component.SHA256 != "" {
			actualHash, err := calculateSHA256(artifactPath)
			if err != nil {
				log.Error("Failed to calculate hash", zap.Error(err))
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to verify artifact hash",
				})
			}
			if actualHash != component.SHA256 {
				os.Remove(artifactPath)
				return c.Status(http.StatusBadRequest).JSON(fiber.Map{
					"error":    "Artifact hash mismatch",
					"expected": component.SHA256,
					"actual":   actualHash,
				})
			}
		}

		savedArtifacts = append(savedArtifacts, component.Artifact)
		log.Info("Saved artifact", zap.String("component", component.Name), zap.String("path", artifactPath))
	}

	// Handle full image if present
	if manifest.FullImage != nil {
		files := form.File["full_image"]
		if len(files) == 0 {
			files = form.File[manifest.FullImage.Artifact]
		}
		if len(files) > 0 {
			artifactPath := filepath.Join(releaseDir, manifest.FullImage.Artifact)
			if err := saveUploadedFile(files[0], artifactPath); err != nil {
				log.Error("Failed to save full image", zap.Error(err))
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to save full image",
				})
			}
			savedArtifacts = append(savedArtifacts, manifest.FullImage.Artifact)
			log.Info("Saved full image", zap.String("path", artifactPath))
		}
	}

	log.Info("Published release",
		zap.String("product", product),
		zap.String("version", manifest.Version),
		zap.String("channel", manifest.Channel),
		zap.Strings("artifacts", savedArtifacts),
	)

	return c.Status(http.StatusCreated).JSON(fiber.Map{
		"status":    "published",
		"product":   product,
		"version":   manifest.Version,
		"channel":   manifest.Channel,
		"artifacts": savedArtifacts,
	})
}

// Helper functions

func isValidProduct(product string) bool {
	return product == "quantix-os" || product == "quantix-vdc"
}

func loadManifest(path string) (*Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}

	return &manifest, nil
}

func listVersions(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var versions []string
	for _, entry := range entries {
		if entry.IsDir() {
			// Check if manifest exists
			manifestPath := filepath.Join(dir, entry.Name(), "manifest.json")
			if _, err := os.Stat(manifestPath); err == nil {
				versions = append(versions, entry.Name())
			}
		}
	}

	// Sort versions in descending order (newest first)
	sort.Slice(versions, func(i, j int) bool {
		return compareVersions(versions[i], versions[j]) > 0
	})

	return versions, nil
}

// compareVersions compares two semantic version strings
// Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
func compareVersions(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	for i := 0; i < 3; i++ {
		var n1, n2 int
		if i < len(parts1) {
			fmt.Sscanf(parts1[i], "%d", &n1)
		}
		if i < len(parts2) {
			fmt.Sscanf(parts2[i], "%d", &n2)
		}

		if n1 > n2 {
			return 1
		} else if n1 < n2 {
			return -1
		}
	}

	return 0
}

func saveUploadedFile(fileHeader *multipart.FileHeader, destPath string) error {
	src, err := fileHeader.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

func calculateSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}
