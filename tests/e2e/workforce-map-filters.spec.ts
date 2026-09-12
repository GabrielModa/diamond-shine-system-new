import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/people', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Plan coverage', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('Workforce coverage map')).toBeVisible({ timeout: 15_000 })
})

test('coverage map opens useful, keeps site filters truthful and excludes inactive sites', async ({ page }) => {
  const people = page.getByRole('button', { name: /People/ })
  const upcomingSites = page.getByRole('button', { name: /Upcoming sites/ })
  const needsStaff = page.getByRole('button', { name: /Needs staff/ })
  const covered = page.getByRole('button', { name: /Covered/ })

  await expect(people).toHaveAttribute('aria-pressed', 'true')
  await expect(upcomingSites).toHaveAttribute('aria-pressed', 'true')
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'false')
  await expect(covered).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-workforce-site-marker]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-workforce-employee-marker]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-workforce-site-marker][data-coverage-state="no_upcoming"]')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await needsStaff.click()
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'true')
  await expect(upcomingSites).toHaveAttribute('aria-pressed', 'false')
  const needsMarkers = page.locator('[data-workforce-site-marker]')
  await expect(needsMarkers.first()).toBeVisible({ timeout: 15_000 })
  const needsCount = await needsMarkers.count()
  expect(needsCount).toBeGreaterThan(0)
  for (let index = 0; index < needsCount; index++) {
    await expect(needsMarkers.nth(index)).toHaveAttribute('data-coverage-state', 'needs_staff')
  }
  await expect(page.locator('[data-workforce-employee-marker]').first()).toBeVisible()

  await needsMarkers.first().dispatchEvent('click')
  await expect(page.getByTestId('map-site-card')).toHaveCount(0)
  await needsMarkers.first().dispatchEvent('dblclick')
  await expect(page.getByTestId('map-site-card')).toBeVisible()
  await needsStaff.click()
  await expect(needsStaff).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-workforce-site-marker]')).toHaveCount(0)
  await expect(page.getByTestId('map-site-card')).toHaveCount(0)
  await expect(page.locator('[data-workforce-employee-marker]').first()).toBeVisible()

  await upcomingSites.click()
  await expect(upcomingSites).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-workforce-site-marker]').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-workforce-site-marker][data-coverage-state="no_upcoming"]')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  const legend = page.getByLabel('Map legend')
  await expect(legend).toContainText('Needs staff')
  await expect(legend).toContainText('Covered')
  await expect(legend).not.toContainText('No upcoming visits')
})
