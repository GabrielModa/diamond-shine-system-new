import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'super@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('full happy path: supervisor records an outcome inspection', async ({ page }) => {
  await page.goto('/feedback')
  await expect(page.getByRole('heading', { name: 'Quality control' })).toBeVisible()
  await page.getByRole('button', { name: 'New inspection' }).click()
  await expect(page.getByLabel('Client site')).toHaveValue(/.+/)
  const checkGroups = page.locator('.quality-result-buttons')
  await expect(checkGroups).toHaveCount(7)
  for (let index = 0; index < 7; index += 1) {
    await checkGroups.nth(index).getByRole('button', { name: 'Pass', exact: true }).click()
  }
  await page.getByLabel('Inspection summary').fill('All audited standards met during the site walk-through.')
  await page.getByRole('button', { name: 'Submit inspection & open actions' }).click()
  await expect(page.getByRole('status')).toContainText('Inspection 100/100 saved.')
})
