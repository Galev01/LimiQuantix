import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    proxy: {
      // Proxy all /api calls to the Go backend
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Proxy Connect-RPC services (gRPC-Web)
      '/limiquantix.': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
