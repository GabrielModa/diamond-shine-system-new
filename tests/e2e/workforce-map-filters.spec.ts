import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/people', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Plan coverage', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Workforce coverage map')).toBeVisible({ timeout: 15_000 })
})

test('coverage map starts clean and site filters are exclusive, truthful and reversible', async ({ page }) => {
  const people = page.getByRole('button', { name: /People/ })
  const allSites = page.getByRole('button', { name: /All sites/ })
  const needsStaff = page.getByRole('button', { name: /Needs staff/ })
  const covered = page.getByRole('button', { name: /Covered/ })

  await expect(people).toHaveAttribute('aria-pressed', 'false')
  await expect(allSites).toHaveAttribute('aria-pressed', 'false')
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'false')
  await expect(covered).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-workforce-site-marker]')).toHaveCount(0)
  await expect(page.locator('[data-workforce-employee-marker]')).toHaveCount(0)

  await needsStaff.click()
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'true')
  const needsMarkers = page.locator('[data-workforce-site-marker]')
  await expect(needsMarkers.first()).toBeVisible({ timeout: 15_000 })
  const needsCount = await needsMarkers.count()
  expect(needsCount).toBeGreaterThan(0)
  for (let index = 0; index < needsCount; index++) {
    await expect(needsMarkers.nth(index)).toHaveAttribute('data-coverage-state', 'needs_staff')
  }

  await needsMarkers.first().dispatchEvent('click')
  await expect(page.getByTestId('map-site-card')).toBeVisible()
  await needsStaff.click()
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-workforce-site-marker]')).toHaveCount(0)
  await expect(page.getByTestId('map-site-card')).toHaveCount(0)

  await allSites.click()
  await expect(allSites).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-workforce-site-marker]').first()).toBeVisible({ timeout: 15_000 })

  const legend = page.getByLabel('Map legend')
  await expect(legend).toContainText('Needs staff')
  await expect(legend).toContainText('Covered')
  await expect(legend).toContainText('No upcoming visits')
})
