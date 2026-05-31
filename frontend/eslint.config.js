import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // This is a react-three-fiber app. R3F's core pattern is to read and mutate
      // refs and three.js objects (camera, meshes, materials) inside useFrame on
      // every frame -- that is by design, not a bug. The React-19 hooks-plugin
      // rules below treat those mutations as errors, which is fundamentally
      // incompatible with R3F, so they are turned off project-wide. (The more
      // useful react-hooks/set-state-in-effect rule is intentionally kept ON.)
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      // Fast-refresh hint only (affects dev HMR, not correctness or the build).
      // allowConstantExport lets a component file also export constants; anything
      // else stays a warning rather than failing lint.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // The networking layer is the client side of a Colyseus room whose schema is
    // defined server-side; the synced state is intentionally untyped here (see the
    // file header). `any` at this network boundary is deliberate, so it is a
    // warning rather than a hard error in src/net only.
    files: ['src/net/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
])
