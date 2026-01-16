# Quantix Update Server

OTA (Over-The-Air) update server for Quantix-OS and Quantix-vDC with Admin UI.

## Quick Start

```bash
# Start the server with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Server is available at http://localhost:9000
# Admin UI is at the same URL
```

## Admin UI

The Admin UI provides a web interface for managing updates:

- **Dashboard** - Overview of releases and server status
- **Releases** - View, download, and delete published releases
- **Publish** - Upload new releases or trigger builds
- **Settings** - Configure authentication and view API reference

![Admin UI](./docs/admin-ui.png)

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/v1/channels` | GET | List available channels |
| `/api/v1/{product}/manifest` | GET | Get latest manifest |
| `/api/v1/{product}/releases` | GET | List all releases |
| `/api/v1/{product}/releases/{version}/{artifact}` | GET | Download artifact |

### Authenticated Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/{product}/publish` | POST | Upload new release |
| `/api/v1/{product}/releases/{version}` | DELETE | Delete a release |
| `/api/v1/admin/git-pull` | POST | Pull latest code from git |
| `/api/v1/admin/build` | POST | Trigger build and publish |
| `/api/v1/admin/status` | GET | Get admin status |

## Products

- `quantix-os` - Quantix-OS hypervisor host updates
- `quantix-vdc` - Quantix-vDC control plane updates

## Example Usage

### Check for Updates

```bash
curl http://localhost:9000/api/v1/quantix-os/manifest?channel=dev
```

### Publish an Update

```bash
curl -X POST http://localhost:9000/api/v1/quantix-os/publish \
  -H "Authorization: Bearer dev-token" \
  -F "manifest=@manifest.json" \
  -F "qx-node=@qx-node.tar.zst" \
  -F "qx-console=@qx-console.tar.zst" \
  -F "host-ui=@host-ui.tar.zst"
```

### Download an Artifact

```bash
curl -O http://localhost:9000/api/v1/quantix-os/releases/0.0.5/qx-node.tar.zst?channel=dev
```

### Git Pull (via API)

```bash
curl -X POST http://localhost:9000/api/v1/admin/git-pull \
  -H "Authorization: Bearer dev-token"
```

### Trigger Build

```bash
curl -X POST http://localhost:9000/api/v1/admin/build \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"product": "quantix-os", "version": "0.0.5", "channel": "dev"}'
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELEASE_DIR` | `/data/releases` | Directory for release artifacts |
| `LISTEN_ADDR` | `0.0.0.0:9000` | Server listen address |
| `PUBLISH_TOKEN` | `dev-token` | Authentication token for publishing |
| `GIT_REPO_PATH` | `/workspace` | Path to git repository for builds |
| `UI_PATH` | `/app/ui/dist` | Path to Admin UI static files |

## Directory Structure

```
releases/
  quantix-os/
    dev/
      0.0.5/
        manifest.json
        qx-node.tar.zst
        qx-console.tar.zst
        host-ui.tar.zst
    stable/
      1.0.0/
        ...
  quantix-vdc/
    dev/
      0.0.5/
        manifest.json
        controlplane.tar.zst
        dashboard.tar.zst
```

## Development

### Build UI locally

```bash
cd ui
npm install
npm run dev    # Development server on port 3002
npm run build  # Production build to dist/
```

### Build Go server locally

```bash
go build -o update-server .
./update-server
```

### Run tests

```bash
go test ./...
cd ui && npm test
```

## Docker Build

The Dockerfile includes a multi-stage build that:
1. Builds the React Admin UI
2. Builds the Go server
3. Creates a minimal Alpine-based production image

```bash
docker build -t quantix-update-server .
docker run -p 9000:9000 -v ./releases:/data/releases quantix-update-server
```
