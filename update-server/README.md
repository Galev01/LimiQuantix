# Quantix Update Server

OTA (Over-The-Air) update server for Quantix-OS and Quantix-vDC.

## Quick Start

```bash
# Start the server with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Server is available at http://localhost:9000
```

## API Endpoints

### Channels
- `GET /api/v1/channels` - List available update channels (dev, beta, stable)

### Manifests
- `GET /api/v1/{product}/manifest?channel=dev` - Get latest manifest for a product
- `GET /api/v1/{product}/releases` - List all releases
- `GET /api/v1/{product}/releases/{version}/manifest?channel=dev` - Get specific version manifest

### Artifacts
- `GET /api/v1/{product}/releases/{version}/{artifact}?channel=dev` - Download artifact

### Publishing (Authenticated)
- `POST /api/v1/{product}/publish` - Upload new release

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

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RELEASE_DIR` | `/data/releases` | Directory for release artifacts |
| `LISTEN_ADDR` | `0.0.0.0:9000` | Server listen address |
| `PUBLISH_TOKEN` | `dev-token` | Authentication token for publishing |

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

### Build locally

```bash
go build -o update-server .
./update-server
```

### Run tests

```bash
go test ./...
```
