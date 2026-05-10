import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // ── Performance optimizations ──
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    // Split large vendor chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'charts': ['lightweight-charts'],
          'globe': ['globe.gl'],
        }
      }
    },
    // Increase chunk warning limit (globe.gl is large)
    chunkSizeWarningLimit: 800,
  },
  // Tree-shake more aggressively
  esbuild: {
    drop: ['console', 'debugger'],
  },
})
