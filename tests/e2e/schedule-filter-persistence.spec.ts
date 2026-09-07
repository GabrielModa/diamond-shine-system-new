import { expect, test } from '@playwright/test'

test('Needs scheduling stays selected while the dispatcher moves between periods', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await page.goto('/schedule?view=week', { waitUntil: 'domcontentloaded' })

  const scheduling = page.locator('[data-health-filter="scheduling"] .schedule-health-stat-main')
  await expect(scheduling).toBeVisible({ timeout: 15_000 })
  await scheduling.click()
  const active = page.locator('.schedule-health-active-filter')
  await expect(active).toContainText('Needs scheduling')

  await page.getByRole('button', { name: 'Next period', exact: true }).click()
  await expect(active).toContainText('Needs scheduling')
  await expect(scheduling).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Previous period', exact: true }).click()
  await expect(active).toContainText('Needs scheduling')
  await expect(scheduling).toHaveAttribute('aria-pressed', 'true')
})
