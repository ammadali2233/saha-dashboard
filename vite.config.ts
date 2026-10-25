import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks so app deploys don't re-download libraries on 4G.
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          supabase: ['@supabase/supabase-js'],
          query: ['@tanstack/react-query'],
          // only form pages load this chunk; the sign-in screen stays light
          forms: ['zod', 'react-hook-form', '@hookform/resolvers'],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
