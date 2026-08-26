import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/mobile-pilot-hardening.test.ts'],
    exclude: ['**/node_modules/**', 'apps/mobile/**'],
    fileParallelism: false,
  },
})
