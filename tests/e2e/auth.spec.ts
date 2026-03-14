import { test, expect } from '@playwright/test'

async function login(page: Parameters<typeof test>[0] extends never ? never : any, email: string, password = 'password123') {
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
