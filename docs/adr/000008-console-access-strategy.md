# ADR 000008: Console Access Strategy

**Status:** Proposed  
**Date:** January 2, 2026  
**Authors:** Architecture Team  
**Category:** Architecture Decision Record  

---

## Context

limiquantix needs to provide web-based console access to VMs, similar to VMware's vSphere Web Console. Users should be able to interact with VMs directly from the browser without installing additional software.

### Requirements

1. **Browser-based**: No client software required (except browser)
2. **Secure**: Encrypted connections, authentication
3. **Low latency**: Responsive keyboard/mouse interaction
4. **Scalable**: Handle multiple concurrent sessions
5. **Cross-platform**: Works on Windows, Linux, macOS guests

---

## Options Analysis

### Option 1: VNC + noVNC (WebSocket Proxy)

**Architecture:**
```
Browser ──WebSocket──► noVNC Proxy ──TCP──► VM VNC Server (libvirt)
```

**How it works:**
1. libvirt exposes VNC server for each VM (port 5900+)
2. A WebSocket proxy (noVNC) translates WebSocket ↔ VNC
3. Browser runs noVNC JavaScript client
4. Keyboard/mouse events sent via WebSocket, screen updates returned

**Pros:**
- ✅ Mature, widely used (Proxmox, OpenStack use noVNC)
- ✅ Works with all guest OS (VNC is guest-agnostic)
- ✅ No guest agent required for basic functionality
- ✅ Open source, MIT licensed
- ✅ Good browser support
- ✅ Can use existing libvirt VNC configuration

**Cons:**
- ❌ VNC protocol is less efficient than SPICE
- ❌ No clipboard sharing (without guest agent)
- ❌ No audio
- ❌ Requires proxy per node or central proxy
- ❌ VNC performance can be poor for high-resolution displays

**Implementation complexity:** Medium

---

### Option 2: SPICE + spice-html5

**Architecture:**
```
Browser ──WebSocket──► SPICE Proxy ──TCP──► VM SPICE Server (libvirt)
```

**How it works:**
1. libvirt exposes SPICE server for each VM
2. WebSocket proxy translates WebSocket ↔ SPICE
3. Browser runs spice-html5 JavaScript client

**Pros:**
- ✅ Better performance than VNC (adaptive compression)
- ✅ Clipboard sharing with guest agent
- ✅ Audio support
- ✅ Multiple monitors
- ✅ USB redirection (with more components)
- ✅ Better for Windows guests

**Cons:**
- ❌ spice-html5 is less mature than noVNC
- ❌ Requires SPICE guest drivers for best experience
- ❌ More complex setup
- ❌ Less browser compatibility
- ❌ Project activity has slowed

**Implementation complexity:** High

---

### Option 3: Apache Guacamole

**Architecture:**
```
Browser ──HTTP/WS──► Guacamole ──► guacd ──VNC/RDP/SSH──► VMs
```

**How it works:**
1. Guacamole server (Java) handles web interface
2. guacd daemon (C) translates to VNC/RDP/SSH
3. Single unified interface for all protocols

**Pros:**
- ✅ Supports VNC, RDP, SSH in one solution
- ✅ Excellent Windows RDP support
- ✅ Recording and playback
- ✅ Multi-factor authentication
- ✅ Session sharing
- ✅ Well-maintained, Apache project

**Cons:**
- ❌ Heavy (Java server, requires PostgreSQL/MySQL)
- ❌ Another service to manage
- ❌ More complex integration
- ❌ May be overkill for VM console

**Implementation complexity:** High (but feature-rich)

---

### Option 4: Built-in Rust WebSocket Proxy

**Architecture:**
```
Browser ──WebSocket──► Node Daemon (Rust) ──TCP──► VM VNC/SPICE
```

**How it works:**
1. Node Daemon implements WebSocket server
2. Proxies WebSocket frames to/from VNC/SPICE
3. Uses existing noVNC or spice-html5 in browser

**Pros:**
- ✅ Single binary, no additional services
- ✅ Can leverage existing Node Daemon authentication
- ✅ Lower latency (direct connection)
- ✅ Full control over security
- ✅ Rust async performance

**Cons:**
- ❌ More development work
- ❌ Need to maintain proxy code
- ❌ VNC/SPICE protocol complexity

**Implementation complexity:** Medium-High

---

### Option 5: libvirt VNC/SPICE WebSocket (Built-in)

**Architecture:**
```
Browser ──WebSocket──► libvirt ──► VM
```

**Since libvirt 1.0.6**, libvirt supports WebSocket natively for SPICE:

```xml
<graphics type='spice' port='-1' autoport='yes'>
  <listen type='address' address='127.0.0.1'/>
  <channel name='main' mode='secure'/>
</graphics>
```

**Pros:**
- ✅ No additional proxy needed
- ✅ Native libvirt support
- ✅ Simpler architecture

**Cons:**
- ❌ Requires libvirt 1.0.6+
- ❌ Limited to SPICE
- ❌ Less flexibility

**Implementation complexity:** Low

---

## Comparison Matrix

| Criteria | VNC+noVNC | SPICE+html5 | Guacamole | Rust Proxy | libvirt WS |
|----------|-----------|-------------|-----------|------------|------------|
| **Maturity** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Performance** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Complexity** | Low | Medium | High | Medium | Low |
| **Browser Support** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Guest Support** | All | All | All | All | All |
| **No Agent Needed** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Clipboard** | ❌ | ✅ | ✅ | ❌/✅ | ✅ |
| **Audio** | ❌ | ✅ | ✅ | ❌/✅ | ✅ |
| **Dependencies** | 1 | 1 | 3+ | 0 | 0 |
| **Proxmox uses** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **OpenStack uses** | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## Recommendation

### Phase 1: VNC + noVNC (Quick Win)

**Rationale:**
- Battle-tested (Proxmox, OpenStack, oVirt all use it)
- Simple integration
- Works immediately with libvirt
- Excellent browser support
- No guest agent required for basic functionality

**Implementation:**
1. Add noVNC proxy to Control Plane (Go) or as separate service
2. Return WebSocket URL from `GetConsole` API
3. Embed noVNC viewer in React dashboard

### Phase 2: Add SPICE Support

For Windows VMs and advanced features:
1. Enable SPICE in libvirt for VMs that request it
2. Add spice-html5 viewer option
3. Use guest agent for clipboard/audio

### Phase 3: Consider Guacamole (Optional)

If RDP or SSH console is needed:
1. Deploy Guacamole for Windows RDP access
2. Integrate with limiquantix authentication
3. Provide unified console experience

---

## Implementation Plan: VNC + noVNC

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (React Dashboard)                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     noVNC Viewer                            │ │
│  │              (JavaScript, embedded in page)                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ WebSocket (wss://...)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Control Plane (Go)                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  WebSocket Proxy                            │ │
│  │         /api/console/{vm_id}/websockify                     │ │
│  │                                                             │ │
│  │  - Authenticate user                                        │ │
│  │  - Look up VM's node and VNC port                          │ │
│  │  - Proxy WebSocket ↔ VNC TCP                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │ TCP connection
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Node Daemon (Rust)                            │
│                       or direct to                               │
│                    libvirt VNC server                            │
│                                                                  │
│  VM: port 5900-5999                                             │
└─────────────────────────────────────────────────────────────────┘
```

### API Design

```protobuf
// Get console connection info
message GetConsoleRequest {
  string vm_id = 1;
  ConsoleType type = 2; // VNC, SPICE
}

message ConsoleResponse {
  string websocket_url = 1;  // wss://host/api/console/{vm_id}/ws
  string token = 2;          // One-time auth token
  ConsoleType type = 3;
  int32 expires_in_secs = 4;
}
```

### Components

1. **Frontend (noVNC)**
   - npm package: `@novnc/novnc`
   - Embed RFB client in React component
   - Connect to WebSocket URL from API

2. **Control Plane (WebSocket Proxy)**
   - Go WebSocket upgrade handler
   - Token-based authentication
   - Proxy to Node Daemon or direct to libvirt

3. **Node Daemon**
   - Return VNC host:port from `GetConsole`
   - Optionally proxy WebSocket (for security)

---

## Security Considerations

1. **Authentication**
   - One-time tokens with short expiry (60 seconds)
   - Validate user has permission to access VM
   - Rate limiting on token generation

2. **Encryption**
   - WebSocket over TLS (wss://)
   - VNC traffic encrypted in transit

3. **Network Isolation**
   - VNC ports only listen on localhost
   - Proxy handles external access
   - No direct VNC exposure to network

4. **Token Handling**
   - Tokens are single-use
   - Tied to specific VM and user
   - Stored in Redis with TTL

---

## Decision

**Chosen Option: VNC + noVNC (Option 1)**

With the following enhancements:
- WebSocket proxy in Control Plane
- Token-based authentication
- SPICE support as Phase 2

---

## References

- [noVNC](https://novnc.com/) - Browser VNC client
- [spice-html5](https://gitlab.freedesktop.org/nicofaith/spice-html5) - Browser SPICE client
- [Apache Guacamole](https://guacamole.apache.org/) - Clientless remote desktop
- [Proxmox VNC Console](https://pve.proxmox.com/wiki/Serial_Terminal) - Proxmox implementation
- [OpenStack Horizon noVNC](https://docs.openstack.org/horizon/latest/) - OpenStack implementation

