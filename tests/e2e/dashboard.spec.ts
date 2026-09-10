import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('old operations desk route is a safe migration bridge to the consolidated workspaces', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Work now lives in the workspace that owns it' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open supplies/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open feedback/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Open command centre/ })).toBeVisible()
  await expect(page.getByText('Nothing was removed.')).toBeVisible()
})
