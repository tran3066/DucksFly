import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared contracts at repo-root types/ (see docs/ARCHITECTURE.md §4).
      '@shared': fileURLToPath(new URL('../types', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // The game app, plus the standalone multiplayer test harness (see test.html).
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        test: fileURLToPath(new URL('./test.html', import.meta.url)),
      },
    },
  },
})
