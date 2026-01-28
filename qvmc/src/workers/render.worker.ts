/* eslint-disable no-restricted-globals */

interface FramebufferUpdate {
    x: number;
    y: number;
    width: number;
    height: number;
    data: string;
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'init':
            canvas = payload.canvas;
            if (canvas) {
                ctx = canvas.getContext('2d');
                // Initialize with black background
                if (ctx) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }
            break;

        case 'resize':
            if (canvas && ctx) {
                const { width, height } = payload;

                // Save content if preserving, but usually resize clears or we just wait for update
                // We'll follow the original logic: save, resize, restore if expanding
                // But for simplicity/speed, often VNC servers send full update after resize.
                // Let's implement the "expand" logic from original component.

                if (canvas.width === width && canvas.height === height) return;

                // If growing, preserve content
                if (width > canvas.width || height > canvas.height) {
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    canvas.width = width;
                    canvas.height = height;
                    ctx.putImageData(imageData, 0, 0);
                } else {
                    canvas.width = width;
                    canvas.height = height;
                }
            }
            break;

        case 'framebuffer':
            if (!ctx || !canvas) return;
            const update = payload as FramebufferUpdate;

            // Auto-resize if needed (same logic as main thread)
            const requiredWidth = update.x + update.width;
            const requiredHeight = update.y + update.height;

            if (canvas.width === 0 || canvas.height === 0) {
                const newWidth = update.x === 0 ? update.width : requiredWidth;
                const newHeight = update.y === 0 ? update.height : requiredHeight;
                canvas.width = newWidth;
                canvas.height = newHeight;
            } else if (requiredWidth > canvas.width || requiredHeight > canvas.height) {
                const newWidth = Math.max(canvas.width, requiredWidth);
                const newHeight = Math.max(canvas.height, requiredHeight);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                canvas.width = newWidth;
                canvas.height = newHeight;
                ctx.putImageData(imageData, 0, 0);
            }

            // Draw the update
            // Decode Base64 string to Uint8ClampedArray
            const binaryString = atob(update.data);
            const len = binaryString.length;
            const bytes = new Uint8ClampedArray(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const imageData = new ImageData(bytes, update.width, update.height);
            ctx.putImageData(imageData, update.x, update.y);
            break;

        case 'clear':
            if (ctx && canvas) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            break;
    }
};

export { };
