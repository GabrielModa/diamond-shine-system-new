import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Targeted audit evidence without video-process teardown on the Windows host.
export default defineConfig({
  ...base,
  testMatch: '**/schedule.spec.ts',
  use: { ...base.use, video: 'off', trace: 'off' },
  globalTimeout: 240_000,
})
