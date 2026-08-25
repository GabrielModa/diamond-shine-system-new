import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node node_modules/next/dist/bin/next start',
    url: 'http://localhost:3100',
    reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_SERVER),
    timeout: 120_000,
    env: {
      EMAIL_TRANSPORT: 'json',
      SESSION_SECRET: 'playwright-only-session-secret-with-32-characters',
      PORT: '3100',
    },
  },
})
