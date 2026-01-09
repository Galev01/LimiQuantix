import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  
  // Tauri expects a fixed port
  server: {
    port: 1420,
    strictPort: true,
  },
  
  // Prevent vite from obscuring Tauri errors
  clearScreen: false,
  
  // Build optimizations
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: ['es2021', 'chrome100', 'safari13'],
    // Don't minify for debugging
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debugging
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  
  // Env prefix for Tauri
  envPrefix: ['VITE_', 'TAURI_'],
});
