import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await page.goto('/schedule', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
  await expect(page.locator('[data-health-filter="conflicts"] .schedule-health-stat-main')).toBeVisible({ timeout: 15_000 })
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('health cards filter the calendar without forcing the details drawer', async ({ page }) => {
  for (const [filter, label] of [
    ['scheduling', 'Needs scheduling'],
    ['conflicts', 'Conflicts'],
    ['confirmation', 'Awaiting confirmation'],
  ] as const) {
    const card = page.locator(`[data-health-filter="${filter}"]`)
    await card.locator('.schedule-health-stat-main').click()

    await expect(page.locator('.schedule-health-active-filter')).toContainText(label)
    await expect(page.getByRole('dialog', { name: new RegExp(`${label} details`, 'i') })).toHaveCount(0)
  }
})

test('needs scheduling adopts the amber operational state in the calendar', async ({ page }) => {
  const card = page.locator('[data-health-filter="scheduling"]')
  await card.locator('.schedule-health-stat-main').click()

  const firstVisit = page.locator('.visit-card').first()
  if (await firstVisit.count()) {
    const background = await firstVisit.evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(background).toBe('rgb(255, 248, 234)')
  }
})

test('conflicts are highlighted on the calendar, counted as affected visits and details are explicitly opt-in', async ({ page }) => {
  const card = page.locator('[data-health-filter="conflicts"]')
  const count = Number(await card.locator('.schedule-health-stat-main strong').innerText())

  await card.locator('.schedule-health-stat-main').click()
  await expect(page.locator('.schedule-health-active-filter')).toContainText('Conflicts')

  if (count > 0) {
    const visibleCards = page.locator('.visit-card')
    const conflictCards = page.locator('.visit-card.schedule-conflict')
    expect(await visibleCards.count()).toBeGreaterThan(0)
    expect(await conflictCards.count()).toBe(await visibleCards.count())
    expect(await conflictCards.count()).toBe(count)

    await card.locator('.schedule-health-stat-details').click()
    const drawer = page.getByRole('dialog', { name: /Conflicts details/i })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(/Double booked/i).first()).toBeVisible()
    await drawer.getByRole('button', { name: 'Close' }).click()
    await expect(drawer).toBeHidden()

    // Closing details must not lose the useful calendar filter.
    await expect(page.locator('.schedule-health-active-filter')).toContainText('Conflicts')
  } else {
    await expect(card.locator('.schedule-health-stat-details')).toBeDisabled()
  }

  await page.locator('.schedule-health-active-filter').getByRole('button', { name: 'Clear' }).click()
  await expect(page.locator('.schedule-health-active-filter')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toHaveClass(/selected/)
})

test('week view always exposes Schedule work on every day', async ({ page }) => {
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click()
  await page.getByRole('button', { name: 'Week', exact: true }).click()

  const columns = page.locator('.week-column')
  await expect(columns.first()).toBeVisible()
  expect(await columns.count()).toBe(7)
  expect(await page.getByRole('button', { name: '+ Schedule work', exact: true }).count()).toBe(7)
})

test('capacity finder tolerates an empty date while the user edits with Backspace', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.getByRole('button', { name: 'Find a time', exact: true }).click()
  const finder = page.locator('.find-time')
  await expect(finder.getByRole('heading', { name: 'Find a workable time' })).toBeVisible()

  const dateInput = finder.locator('input[type="date"]')
  const originalDate = await dateInput.inputValue()
  expect(originalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  // This reproduces the transient empty value produced while editing a native
  // date field with Backspace. It must never reach availability calculations.
  await dateInput.fill('')
  await page.waitForTimeout(100)
  expect(pageErrors.some((message) => /Invalid date value/i.test(message))).toBe(false)
  await expect(finder.getByRole('heading', { name: 'Find a workable time' })).toBeVisible()

  await finder.getByRole('heading', { name: 'Find a workable time' }).click()
  await expect(dateInput).toHaveValue(originalDate)

  await dateInput.fill('2027-09-25')
  await expect(dateInput).toHaveValue('2027-09-25')
  await expect(finder.locator('.find-time-slots button').first()).toBeVisible()
  expect(await finder.locator('.find-time-slots button').count()).toBeGreaterThanOrEqual(4)
  expect(pageErrors.some((message) => /Invalid date value/i.test(message))).toBe(false)
})
