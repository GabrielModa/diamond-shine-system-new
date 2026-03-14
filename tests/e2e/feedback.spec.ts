import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'super@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('full happy path: supervisor submits a performance evaluation', async ({ page }) => {
  await page.goto('/feedback')
  await page.selectOption('#employeeName', { label: 'Maria Silva' })
  await page.click('#submitBtn')
  await expect(page.locator('.toast.success')).toBeVisible()
})
