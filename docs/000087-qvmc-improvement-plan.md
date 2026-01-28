# 000087 - QVMC Performance and UI Improvement Plan

## Summary
This document outlines a roadmap for the next generation of the Quantix Virtual Machine Console (QVMC). The goal is to evolve the current VNC client from a functional viewer into a high-performance, professional-grade remote desktop tool comparable to industry standards (e.g., VMware Remote Console, virt-viewer).

## 1. Performance Architecture Overhaul

### 1.1 WebGL Rendering (Replacing Canvas 2D)
*   **Current State**: Uses `CanvasRenderingContext2D.putImageData()`. This is CPU-intensive and blocks the main thread during large frame updates (4K resolutions).
*   **Improvement**: Implement a **WebGL 2.0 Renderer**.
    *   Treat the framebuffer as a GL Texture.
    *   Use GPU scaling (bilinear/bicubic shaders) for smoother zooming.
    *   **Benefit**: Massive reduction in CPU usage; smooth 60FPS rendering even at 4K.

### 1.2 WebAssembly (Wasm) Decoder
*   **Current State**: Raw pixel data is passed from Rust backend to Frontend via Tauri JSON serialization (or raw bytes events). This creates serialization overhead.
*   **Improvement**: Move the RFB (VNC) protocol decoding logic into a **Rust-based Wasm module** running in a Web Worker.
    *   Backend simply streams raw TCP bytes to the Frontend.
    *   Wasm decoder processes encodings (Tight, Zlib, ZRLE) significantly faster than JS.
    *   **Benefit**: Lower latency, reduced bandwidth usage (better compression support).

### 1.3 OffscreenCanvas & Web Workers
*   **Current State**: Rendering happens on the main UI thread. Heavy updates cause UI stutter (buttons unresponsive).
*   **Improvement**: Move the rendering loop to a **Web Worker** using `OffscreenCanvas`.
    *   The Main thread handles *only* user input (mouse/keyboard).
    *   The Worker thread handles network data -> decode -> render.
    *   **Benefit**: "Butter smooth" UI responsiveness regardless of screen change rate.

## 2. User Interface Enhancements

### 2.1 Detached Windows (Multi-Monitor Workflow)
*   **Feature**: Allow users to "pop out" a VM console tab into a separate OS window.
*   **Use Case**: Managing multiple VMs simultaneously on multi-monitor setups.
*   **Implementation**: Use Tauri's multi-window capability.

### 2.2 Advanced Input Handling
*   **Local Cursor Rendering**:
    *   Hide the generic OS cursor within the canvas.
    *   Render a local dot/arrow cursor immediately on mouse move (hiding latency).
    *   Sycn with remote cursor position when server updates arrive.
*   **Macro / Shortcut Editor**:
    *   Customizable toolbar buttons for complex key combos (`Ctrl+Alt+F`, `Win+R`, etc.).
    *   Ability to send "Text Strings" (simulated typing) for pasting long passwords.

### 2.3 Visual Polish & Customization
*   **Adaptive Quality**:
    *   Slider to trade off "Image Quality" vs "Refresh Rate" (e.g., turn off JPEG compression for text clarity vs max compression for video).
*   **Connection Stats Overlay**:
    *   Real-time graph of Latency (ms), Bandwidth (Mbps), and FPS.

## 3. Implementation Phases

### Phase 1: The Foundation (Performance)
- [ ] Move VNC decoding logic to Web Worker (decouple from UI).
- [ ] Implement OffscreenCanvas rendering.

### Phase 2: The Engine (Speed)
- [ ] Implement WebGL renderer for GPU acceleration.
- [ ] Implement Local Cursor rendering to mask latency.

### Phase 3: The Experience (UI)
- [ ] Implement "Pop-out Window" feature.
- [ ] Add Stats Overlay and Quality Controls.
- [ ] Add Macro Editor.
