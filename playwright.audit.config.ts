import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Targeted Schedule audit; screenshots provide evidence without recording video.
export default defineConfig({
  ...base,
  testMatch: '**/schedule.spec.ts',
  use: { ...base.use, video: 'off', trace: 'off' },
  globalTimeout: 240_000,
})
