// Package main - Cryptographic signing for update manifests
// Uses Ed25519 for signing (TUF-compatible approach)
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.uber.org/zap"
)

// SignedManifest wraps a manifest with cryptographic signature
type SignedManifest struct {
	// The actual manifest content (serialized as JSON)
	Manifest json.RawMessage `json:"manifest"`

	// Signature over the manifest bytes
	Signature string `json:"signature"`

	// Key ID used for signing (allows key rotation)
	KeyID string `json:"key_id"`

	// Timestamp of signing
	SignedAt time.Time `json:"signed_at"`

	// Signature algorithm (always "ed25519" for now)
	Algorithm string `json:"algorithm"`
}

// SigningConfig holds signing key configuration
type SigningConfig struct {
	PrivateKeyPath string // Path to private key (PEM or raw base64)
	PublicKeyPath  string // Path to public key
	KeyID          string // Key identifier for rotation
}

var (
	signingPrivateKey ed25519.PrivateKey
	signingPublicKey  ed25519.PublicKey
	signingKeyID      string
	signingEnabled    bool
)

// InitSigning initializes the signing subsystem
func InitSigning() error {
	privateKeyPath := getEnv("SIGNING_PRIVATE_KEY", "")
	publicKeyPath := getEnv("SIGNING_PUBLIC_KEY", "")
	signingKeyID = getEnv("SIGNING_KEY_ID", "quantix-release-key-1")

	if privateKeyPath == "" {
		log.Info("Signing disabled - no SIGNING_PRIVATE_KEY configured")
		signingEnabled = false
		return nil
	}

	// Load private key
	privateKeyData, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return fmt.Errorf("failed to read private key: %w", err)
	}

	// Decode base64 private key (64 bytes for Ed25519)
	signingPrivateKey, err = base64.StdEncoding.DecodeString(string(privateKeyData))
	if err != nil {
		// Try raw bytes
		signingPrivateKey = privateKeyData
	}

	if len(signingPrivateKey) != ed25519.PrivateKeySize {
		return fmt.Errorf("invalid private key size: expected %d, got %d", ed25519.PrivateKeySize, len(signingPrivateKey))
	}

	// Derive public key from private key
	signingPublicKey = signingPrivateKey.Public().(ed25519.PublicKey)

	// Optionally save/verify public key
	if publicKeyPath != "" {
		pubKeyBase64 := base64.StdEncoding.EncodeToString(signingPublicKey)
		if err := os.WriteFile(publicKeyPath, []byte(pubKeyBase64), 0644); err != nil {
			log.Warn("Failed to write public key", zap.Error(err))
		}
	}

	signingEnabled = true
	log.Info("Signing enabled",
		zap.String("key_id", signingKeyID),
		zap.String("public_key", base64.StdEncoding.EncodeToString(signingPublicKey)[:16]+"..."),
	)

	return nil
}

// GenerateSigningKeyPair generates a new Ed25519 keypair
func GenerateSigningKeyPair(outputDir string) error {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate key pair: %w", err)
	}

	// Save private key (base64 encoded)
	privateKeyPath := filepath.Join(outputDir, "signing-private.key")
	privateKeyBase64 := base64.StdEncoding.EncodeToString(privateKey)
	if err := os.WriteFile(privateKeyPath, []byte(privateKeyBase64), 0600); err != nil {
		return fmt.Errorf("failed to write private key: %w", err)
	}

	// Save public key (base64 encoded)
	publicKeyPath := filepath.Join(outputDir, "signing-public.key")
	publicKeyBase64 := base64.StdEncoding.EncodeToString(publicKey)
	if err := os.WriteFile(publicKeyPath, []byte(publicKeyBase64), 0644); err != nil {
		return fmt.Errorf("failed to write public key: %w", err)
	}

	fmt.Printf("Generated Ed25519 keypair:\n")
	fmt.Printf("  Private key: %s (keep secret!)\n", privateKeyPath)
	fmt.Printf("  Public key:  %s (embed in agents)\n", publicKeyPath)
	fmt.Printf("  Public key (base64): %s\n", publicKeyBase64)

	return nil
}

// SignManifest signs a manifest and returns a SignedManifest
func SignManifest(manifest *Manifest) (*SignedManifest, error) {
	if !signingEnabled {
		return nil, fmt.Errorf("signing is not enabled")
	}

	// Serialize manifest to JSON (canonical form)
	manifestBytes, err := json.Marshal(manifest)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize manifest: %w", err)
	}

	// Sign the manifest bytes
	signature := ed25519.Sign(signingPrivateKey, manifestBytes)

	return &SignedManifest{
		Manifest:  manifestBytes,
		Signature: base64.StdEncoding.EncodeToString(signature),
		KeyID:     signingKeyID,
		SignedAt:  time.Now().UTC(),
		Algorithm: "ed25519",
	}, nil
}

// VerifySignedManifest verifies the signature on a signed manifest
// publicKey should be the base64-encoded public key
func VerifySignedManifest(signed *SignedManifest, publicKeyBase64 string) (*Manifest, error) {
	// Decode public key
	publicKey, err := base64.StdEncoding.DecodeString(publicKeyBase64)
	if err != nil {
		return nil, fmt.Errorf("invalid public key encoding: %w", err)
	}

	if len(publicKey) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid public key size")
	}

	// Decode signature
	signature, err := base64.StdEncoding.DecodeString(signed.Signature)
	if err != nil {
		return nil, fmt.Errorf("invalid signature encoding: %w", err)
	}

	// Verify signature
	if !ed25519.Verify(publicKey, signed.Manifest, signature) {
		return nil, fmt.Errorf("signature verification failed")
	}

	// Parse manifest
	var manifest Manifest
	if err := json.Unmarshal(signed.Manifest, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse manifest: %w", err)
	}

	return &manifest, nil
}

// IsSigningEnabled returns whether signing is enabled
func IsSigningEnabled() bool {
	return signingEnabled
}

// GetPublicKey returns the base64-encoded public key
func GetPublicKey() string {
	if !signingEnabled {
		return ""
	}
	return base64.StdEncoding.EncodeToString(signingPublicKey)
}
