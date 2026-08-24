import { test, expect, type Page } from '@playwright/test'

async function login(page: Page, email: string, password = 'password123') {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(home|forbidden|dashboard|supplies|feedback)/)
}

test('unauthenticated user visiting /dashboard is redirected to /login', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('admin can access /dashboard', async ({ page }) => {
  await login(page, 'admin@ds.ie')
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('mobile sign-in prioritizes the form without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')

  await expect(page.locator('.auth-card-brand')).toBeVisible()
  await expect(page.locator('.auth-hero')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(hasHorizontalOverflow).toBe(false)
})
