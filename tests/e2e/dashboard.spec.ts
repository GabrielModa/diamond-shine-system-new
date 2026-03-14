import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('dashboard loads with Urgent, Normal and Low stat cards', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.locator('text=Urgent')).toBeVisible()
  await expect(page.locator('text=Normal')).toBeVisible()
  await expect(page.locator('text=Low')).toBeVisible()
})
