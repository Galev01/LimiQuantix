# 000086 - Guest Agent Enhancement Plan (VMware Tools-like Features)

## Summary
To provide a seamless "VMware Tools" style experience in Quantix-VNC (QvMC), we need to expand the capabilities of the `limiquantix-guest-agent`. Currently, the agent focuses on telemetry and basic lifecycle (power/reset). The next phase of development will focus on **Desktop Integration** to bridge the gap between the host client and the guest OS.

## 1. Core Objectives
1.  **Dynamic Resolution Sync**: Automatically resize the Guest OS display resolution when the QvMC window is resized.
2.  **Clipboard Sharing**: Bi-directional copy/paste of text (and later files) between Host and Guest.
3.  **Seamless Mouse**: Ensure smooth, uncaptured mouse movement (already partially handled by connection type, but agent can improve precision).
4.  **File Transfer**: Drag-and-drop file support.
5.  **Time Synchronization**: Keep guest clock in sync with host.

## 2. Technical Architecture

### Communication Channel
We will continue to use the existing **virtio-serial** channel (`/dev/virtio-ports/org.limiquantix.agent.0`) but will extend the Protobuf protocol.

**Changes required:**
- Add new message types to `limiquantix-proto`:
    - `DisplayResizeEvent` (Host -> Guest): `{ width, height, dpi }`
    - `ClipboardEvent` (Bi-directional): `{ mime_type, data }`
    - `FileTransferStart` / `FileTransferChunk`

### Guest OS Support Strategy
- **Linux**:
    - **Display**: Use `xrandr` (X11) or Wayland protocols (wlr-output-management) to change resolution.
    - **Clipboard**: Interact with X11 selection or Wayland clipboard APIs.
- **Windows**:
    - **Display**: Use User32 `ChangeDisplaySettingsEx`.
    - **Clipboard**: Use OLE/Win32 Clipboard APIs.

## 3. Feature Breakdown

### 3.1 Dynamic Resolution Sync (Priority: High)
*Problem*: Currently, resizing the VNC window scales the image (making it blurry or pixelated). We want the Guest OS to actually change its resolution to match the window.

**Implementation Plan:**
1.  **Host Side (QvMC)**:
    - Listen for window resize events.
    - Send a throttled `DisplayResizeEvent` via the Control Plane -> Hypervisor -> Guest Agent.
2.  **Guest Agent**:
    - Listen for `DisplayResizeEvent`.
    - Detect current window system (Headless, X11, Wayland, Windows).
    - Execute resolution change command.
        - *Linux Command*: `xrandr --output Virtual-1 --mode <width>x<height>` (may need to create modeline on the fly).
        - *Windows API*: Call `ChangeDisplaySettings`.

### 3.2 Shared Clipboard (Priority: High)
*Problem*: Users cannot copy connection strings or code from their host machine to the VM.

**Implementation Plan:**
1.  **Protocol**: Add `ClipboardUpdate` message.
2.  **Mechanism**:
    - **Guest -> Host**: Agent polls clipboard or sets OS clipboard listener. When changed, send data to Host.
    - **Host -> Guest**: When QvMC gains focus or detects clipboard change, send data to Guest Agent. Agent writes to OS clipboard.
3.  **Security**: Add configuration option to disable clipboard sharing for strict environments.

### 3.3 File Transfer (Drag & Drop) (Priority: Medium)
*Problem*: Moving ISOs or scripts requires setting up network shares or SCP.

**Implementation Plan:**
1.  **User Action**: User drags file onto QvMC canvas.
2.  **Transfer**:
    - QvMC chunks file and sends via WebSocket to Control Plane -> Agent.
    - Agent reassembles file in a temporary or user-specified directory (e.g., Desktop).

## 4. Implementation Roadmap

### Phase 1: Protocol & Foundation
- [ ] Update `limiquantix-proto` with new message definitions.
- [ ] Refactor Agent to support distinct "capabilities" modules (DisplayModule, ClipboardModule).

### Phase 2: Linux Display & Clipboard
- [ ] Implement `xrandr` wrapper for Linux resolution sync.
- [ ] Implement X11 clipboard watcher/writer.
- [ ] Update QvMC to send resize events.

### Phase 3: Windows Support
- [ ] Port agent to Windows Service.
- [ ] Implement Win32 API calls for Display and Clipboard.

### Phase 4: Advanced Features
- [ ] File Drag & Drop.
- [ ] Guest Quiescing (fsfreeze) for snapshots.

## 5. Prototype: Protocol Definition

```protobuf
// Example extension to AgentMessage payload

message DisplayResizeEvent {
    uint32 width = 1;
    uint32 height = 2;
    uint32 dpi = 3;
}

message ClipboardEvent {
    enum Type {
        TEXT = 0;
        IMAGE_PNG = 1;
    }
    Type type = 1;
    bytes data = 2;
}

message AgentMessage {
    // ... existing fields ...
    oneof payload {
        // ... existing payloads ...
        DisplayResizeEvent display_resize = 10;
        ClipboardEvent clipboard_update = 11;
    }
}
```

## 6. Comparison with Existing Tools
| Feature           |  Basic VNC   | Current Agent |   Planned Agent    |  VMware Tools  |
| :---------------- | :----------: | :-----------: | :----------------: | :------------: |
| Telemetry         |      No      |      Yes      |        Yes         |      Yes       |
| Power Ops         |  ACPI only   |  API driven   |     API driven     |   API driven   |
| **Resizing**      | Client Scale |      No       |  **Guest Resize**  |  Guest Resize  |
| **Clipboard**     |      No      |      No       | **Bi-directional** | Bi-directional |
| **File Transfer** |      No      |      No       |  **Drag & Drop**   |  Drag & Drop   |

This plan moves Quantix-KVM from a "Server Virtualization" experience to a "Desktop Virtualization" experience.
