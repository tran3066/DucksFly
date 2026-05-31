import { defineConfig } from 'vitest/config'

// Vitest runs in jsdom so component and DOM-touching code (webcam, pose loop)
// can be tested. globals:true lets tests use describe/it/expect without imports
// (we still import them explicitly for clarity). Only *.test.ts(x) files run.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
