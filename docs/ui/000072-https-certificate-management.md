# 000072 - HTTP/HTTPS and Certificate Management

This document describes the HTTP/HTTPS implementation and certificate management features for the Quantix Host UI.

## Overview

The Quantix Host UI supports flexible HTTP/HTTPS configuration:
- **HTTP on port 8080** (default) - Enabled by default for easy setup
- **HTTPS on port 8443** (optional) - Enable with `--enable-https`
- **Self-signed certificates** (auto-generated when HTTPS enabled)
- **Manual certificate upload** (bring your own certificate)
- **ACME/Let's Encrypt** (automatic certificate provisioning)
- **HTTP→HTTPS redirect** (optional redirect from port 80)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Server Architecture                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Browser                                                        │
│      │                                                           │
│      │  HTTP :8080 (default)                                     │
│      ├─────────────►  axum HTTP server                          │
│      │                                                           │
│      │  HTTPS :8443 (optional, --enable-https)                   │
│      ├─────────────►  axum-server (rustls)                      │
│      │                                                           │
│      │  HTTP :80 (optional, --redirect-http)                     │
│      └─────────────►  Redirect Server ─── 301 ──► HTTPS         │
│                                                                  │
│                       TlsManager                                 │
│                              │                                   │
│           ┌─────────────────┼─────────────────┐                 │
│           │                 │                 │                  │
│           ▼                 ▼                 ▼                  │
│    Self-Signed        Manual Upload      ACME Client             │
│    (rcgen)            (rustls-pemfile)   (instant-acme)          │
│                                                                  │
│   Certificate Storage: /etc/limiquantix/certs/                   │
│   ├── server.crt                                                 │
│   ├── server.key                                                 │
│   ├── ca.crt (optional)                                          │
│   ├── mode.json                                                  │
│   └── acme/                                                      │
│       └── account.json                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Details

### TLS Manager (`tls.rs`)

The `TlsManager` struct handles all certificate operations:

```rust
pub struct TlsManager {
    config: TlsConfig,
    cert_dir: PathBuf,
}

impl TlsManager {
    /// Initialize TLS - ensure certificates exist
    pub async fn initialize(&self) -> Result<()>;
    
    /// Generate self-signed certificate
    pub async fn generate_self_signed(&self) -> Result<()>;
    
    /// Upload custom certificate
    pub async fn upload_certificate(&self, cert: &str, key: &str, ca: Option<&str>) -> Result<()>;
    
    /// Get certificate information
    pub fn get_certificate_info(&self) -> Result<CertificateInfo>;
    
    /// Load rustls ServerConfig
    pub fn load_server_config(&self) -> Result<Arc<ServerConfig>>;
}
```

### ACME Manager (`tls.rs`)

The `AcmeManager` handles Let's Encrypt integration:

```rust
pub struct AcmeManager {
    tls_config: TlsConfig,
    cert_dir: PathBuf,
    account_dir: PathBuf,
}

impl AcmeManager {
    /// Get ACME account information
    pub fn get_account_info(&self) -> AcmeAccountInfo;
    
    /// Register ACME account
    pub async fn register_account(&self, email: &str) -> Result<()>;
    
    /// Issue certificate via ACME
    pub async fn issue_certificate(&self, domains: &[String]) -> Result<AcmeChallengeStatus>;
}
```

### Configuration

TLS configuration in `config.rs`:

```rust
pub struct TlsConfig {
    pub enabled: bool,              // Enable HTTPS
    pub redirect_http: bool,        // Enable HTTP→HTTPS redirect
    pub redirect_port: u16,         // HTTP redirect port (default: 80)
    pub cert_path: String,          // Certificate file path
    pub key_path: String,           // Private key file path
    pub ca_path: Option<String>,    // CA certificate (for mTLS)
    pub mode: CertificateMode,      // self-signed, manual, acme
    pub self_signed: SelfSignedConfig,
    pub acme: AcmeConfig,
}

pub struct SelfSignedConfig {
    pub common_name: Option<String>,
    pub validity_days: u32,
}

pub struct AcmeConfig {
    pub enabled: bool,
    pub email: Option<String>,
    pub directory_url: String,
    pub domains: Vec<String>,
    pub challenge_type: String,     // http-01 or dns-01
    pub account_path: String,
    pub auto_renew: bool,
    pub renew_before_days: u32,
}
```

## API Endpoints

### Get Certificate Information

```http
GET /api/v1/settings/certificates
```

Response:
```json
{
  "mode": "self-signed",
  "commonName": "quantix-host",
  "subjectAltNames": ["quantix-host", "localhost", "127.0.0.1"],
  "issuer": "Quantix-KVM Host UI (quantix-host)",
  "validFrom": "2026-01-07T00:00:00Z",
  "validUntil": "2027-01-07T00:00:00Z",
  "daysUntilExpiry": 365,
  "isExpired": false,
  "expiresSoon": false,
  "fingerprint": "SHA256:xx:xx:xx:xx",
  "certPath": "/etc/limiquantix/certs/server.crt",
  "keyPath": "/etc/limiquantix/certs/server.key"
}
```

### Upload Custom Certificate

```http
POST /api/v1/settings/certificates/upload
Content-Type: application/json

{
  "certificate": "-----BEGIN CERTIFICATE-----\n...",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...",
  "caCertificate": "-----BEGIN CERTIFICATE-----\n..."  // optional
}
```

### Generate Self-Signed Certificate

```http
POST /api/v1/settings/certificates/generate
```

### Reset to Self-Signed

```http
DELETE /api/v1/settings/certificates
```

### Get ACME Account Info

```http
GET /api/v1/settings/certificates/acme
```

Response:
```json
{
  "enabled": false,
  "email": null,
  "directoryUrl": "https://acme-v02.api.letsencrypt.org/directory",
  "registered": false,
  "domains": [],
  "challengeType": "http-01",
  "autoRenew": true,
  "renewBeforeDays": 30
}
```

### Register ACME Account

```http
POST /api/v1/settings/certificates/acme/register
Content-Type: application/json

{
  "email": "admin@example.com"
}
```

### Issue ACME Certificate

```http
POST /api/v1/settings/certificates/acme/issue
Content-Type: application/json

{
  "domains": ["quantix.example.com"]
}
```

Response:
```json
{
  "challengeType": "http-01",
  "domain": "quantix.example.com",
  "status": "pending",
  "token": "abc123...",
  "keyAuthorization": "abc123.xyz789..."
}
```

## CLI Arguments

```bash
# HTTP server (port 8080 - default)
--http-listen ADDR       # HTTP listen address (default: 0.0.0.0:8080)
--no-http                # Disable HTTP server

# HTTPS server (port 8443 - optional)
--enable-https           # Enable HTTPS server
--https-listen ADDR      # HTTPS listen address (default: 0.0.0.0:8443)
--tls-cert PATH          # Path to certificate file
--tls-key PATH           # Path to private key file

# HTTP→HTTPS redirect (port 80 - optional)
--redirect-http          # Enable HTTP→HTTPS redirect
--redirect-port PORT     # HTTP redirect port (default: 80)

# Examples
limiquantix-node                           # HTTP only on 8080
limiquantix-node --enable-https            # HTTP (8080) + HTTPS (8443)
limiquantix-node --no-http --enable-https  # HTTPS only on 8443
limiquantix-node --enable-https --redirect-http  # HTTPS + redirect from :80
```

## Dependencies

Added to workspace `Cargo.toml`:

```toml
# TLS and certificate management
axum-server = { version = "0.7", features = ["tls-rustls"] }
rustls = "0.23"
rustls-pemfile = "2.1"
tokio-rustls = "0.26"
rcgen = "0.13"           # Self-signed cert generation
instant-acme = "0.7"     # ACME client
base64 = "0.22"
```

## Security Considerations

1. **Private Key Protection**: Private keys are stored with 600 permissions on Unix systems
2. **Self-Signed Warnings**: Browser warnings are expected for self-signed certs
3. **ACME Domain Validation**: Requires valid DNS pointing to the host
4. **HTTP Redirect**: Should not be exposed to untrusted networks without HTTPS

## Testing

To test the implementation:

1. **HTTP Only (Default)**:
   ```bash
   # Start daemon with HTTP only
   limiquantix-node --dev
   
   # Access UI via HTTP
   curl http://localhost:8080/api/v1/host/health
   firefox http://localhost:8080
   ```

2. **HTTPS Server**:
   ```bash
   # Start daemon with HTTPS enabled
   limiquantix-node --dev --enable-https
   
   # Access via HTTP (8080) or HTTPS (8443)
   curl http://localhost:8080/api/v1/host/health
   curl -k https://localhost:8443/api/v1/host/health
   ```

3. **HTTPS Only (No HTTP)**:
   ```bash
   # Disable HTTP, only run HTTPS
   limiquantix-node --dev --no-http --enable-https
   
   # Only HTTPS works
   curl -k https://localhost:8443/api/v1/host/health
   ```

4. **HTTP→HTTPS Redirect**:
   ```bash
   # Enable redirect from port 80
   limiquantix-node --dev --enable-https --redirect-http
   
   # Port 80 redirects to HTTPS
   curl -v http://localhost:80  # 301 redirect to https://localhost:8443
   ```

5. **Certificate Upload**:
   ```bash
   # Generate test cert
   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
   
   # Upload via API (works on HTTP or HTTPS)
   curl -X POST http://localhost:8080/api/v1/settings/certificates/upload \
     -H "Content-Type: application/json" \
     -d "$(jq -n --rawfile cert cert.pem --rawfile key key.pem \
       '{certificate: $cert, privateKey: $key}')"
   ```

## Future Enhancements

1. **DNS-01 Challenge**: Support for wildcard certificates via DNS validation
2. **Certificate Renewal Daemon**: Background task for automatic renewal
3. **Certificate Rotation**: Zero-downtime certificate updates
4. **Mutual TLS**: Client certificate authentication
5. **Hardware Security Module**: HSM support for key storage
