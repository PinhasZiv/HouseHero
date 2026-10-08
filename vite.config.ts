/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { swVersionPlugin } from './scripts/swVersion'

// On GitHub Pages the app is served from https://<user>.github.io/<repo>/, so the
// build needs to know its sub-path. The deploy workflow sets VITE_BASE from the
// repository name; locally it defaults to the root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), swVersionPlugin()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // The libraries change far less often than the app; in their own
        // files they stay cached across deploys instead of being downloaded
        // again with every change to a screen.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'supabase'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          return 'vendor'
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'supabase/**/*.test.ts', 'scripts/**/*.test.ts'] },
})
