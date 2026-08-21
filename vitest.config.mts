import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', '.next/**'],
    env: {
      EMAIL_TRANSPORT: 'json',
    },
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
})
