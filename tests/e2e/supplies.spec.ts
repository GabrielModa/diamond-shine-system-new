import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'employee@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('full happy path: employee submits a supply request', async ({ page }) => {
  await page.goto('/supplies')
  await page.fill('input[placeholder="Enter your name"]', 'Emma Employee')
  await page.selectOption('#location', 'TechCorp Office - Dublin 2')
  await page.click('[data-priority="normal"]')
  await page.click('#submitBtn')
  await expect(page.locator('.toast.success')).toBeVisible()
})
