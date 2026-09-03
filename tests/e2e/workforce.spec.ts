import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

async function openLive(page: Page) {
  await page.goto('/live-operations', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Live workforce', level: 1 })).toBeVisible({ timeout: 15_000 })
}

async function openPerformance(page: Page) {
  await page.goto('/team-performance', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Team performance', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Team workload' })).toBeVisible({ timeout: 15_000 })
}

async function openCoverage(page: Page) {
  await page.goto('/people', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Plan coverage', level: 1 })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Match person to place' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('combobox', { name: 'Choose team member' })).toBeVisible()
}

async function chooseEmployee(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Choose team member' }).click()
  const search = page.getByLabel('Search team member')
  await search.fill(name)
  const option = page.getByRole('listbox').getByRole('option', { name: new RegExp(name, 'i') })
  await expect(option).toBeVisible()
  await option.click()
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('live now separates active work from expected context and exposes operational attention', async ({ page }) => {
  await openLive(page)

  const summary = page.locator('[aria-label="Live workforce summary"]')
  const onJobMetric = summary.getByRole('button', { name: /On job/ })
  const attentionMetric = summary.getByRole('button', { name: /Attention/ })
  const schoolMetric = summary.getByRole('button', { name: /Expected school/ })
  await expect(onJobMetric).toBeVisible({ timeout: 15_000 })
  await expect(onJobMetric).toContainText('Active timers')
  await expect(attentionMetric).toContainText('Late, signal, incident')
  await expect(schoolMetric).toContainText('Schedule context')
  await expect(page.getByRole('heading', { name: 'Live operations map', exact: true })).toBeVisible()
  await expect(page.getByText(/Work GPS appears only from an active visit timer/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Team activity', exact: true })).toBeVisible()

  await openPerformance(page)
})

test('workforce performance supports custom dates and operational filters', async ({ page }) => {
  await openPerformance(page)
  await expect(page.getByText('Team workload')).toBeVisible()
  await expect(page.getByText('Worked', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const dateDialog = page.getByRole('dialog', { name: 'Filters' })
  await dateDialog.getByLabel('From', { exact: true }).fill('2026-08-18')
  await dateDialog.getByLabel('To', { exact: true }).fill('2026-08-24')
  await dateDialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dateDialog).toHaveCount(0)

  const dateInputs = page.locator('.wf4-date-range input[type="date"]')
  await expect(dateInputs).toHaveCount(2)
  await expect(dateInputs.nth(0)).toHaveValue('2026-08-18')
  await expect(dateInputs.nth(1)).toHaveValue('2026-08-24')

  await openPerformance(page)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const statusDialog = page.getByRole('dialog', { name: 'Filters' })
  const statusFilter = statusDialog.getByRole('combobox', { name: 'Status', exact: true })
  await statusFilter.click()
  await page.getByRole('listbox', { name: 'Status' }).getByRole('option', { name: 'Capacity left', exact: true }).click()
  await expect(statusFilter).toContainText('Capacity left')
  await statusDialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(statusDialog).toHaveCount(0)

  const filteredRows = page.locator('.wf4-row')
  await expect(filteredRows.first()).toBeVisible()
  const filteredCount = await filteredRows.count()
  expect(filteredCount).toBeGreaterThan(0)
  for (let index = 0; index < filteredCount; index++) {
    await expect(filteredRows.nth(index).locator('.wf2-status')).toHaveText('Available')
  }

  await openPerformance(page)
  await page.locator('.wf4-row').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Daily hours')).toBeVisible()
})

test('map and route planner stay synchronized and expose walking', async ({ page }) => {
  await openCoverage(page)

  const siteSelect = page.getByRole('combobox', { name: 'Choose service site' })
  await expect(page.getByRole('button', { name: '🚶 Walk' })).toBeVisible()

  await chooseEmployee(page, 'Aisha')
  await expect(page.getByTestId('map-employee-card')).toBeVisible()

  const siteMarkers = page.locator('[data-workforce-site-marker]')
  await expect(siteMarkers.first()).toBeVisible({ timeout: 15_000 })
  await siteMarkers.first().dispatchEvent('click')
  await expect(siteSelect).not.toContainText('Search service site…')

  await page.getByRole('button', { name: '🚶 Walk' }).click()
  await expect(page.locator('.wf-map-focus-card')).toBeVisible()
})

test('scenario matrix exposes many employees and route-origin overrides', async ({ page }) => {
  await openCoverage(page)

  await page.getByRole('combobox', { name: 'Choose team member' }).click()
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.first()).toBeVisible()
  expect(await options.count()).toBeGreaterThanOrEqual(12)
  const optionLabels = await options.allTextContents()
  expect(optionLabels.some((option) => /Aisha Khan/i.test(option))).toBeTruthy()
  expect(optionLabels.some((option) => /Aoife Byrne/i.test(option))).toBeTruthy()

  const search = page.getByLabel('Search team member')
  await search.fill('Aisha')
  await page.getByRole('listbox').getByRole('option', { name: /Aisha Khan/ }).click()
  await expect(page.getByTestId('map-employee-card')).toContainText(/Scenario Test College|Pearse Street/)

  await page.getByRole('button', { name: '⌂ Home' }).click()
  await expect(page.getByText(/Previewing route from the employee home/i)).toBeVisible()

  await page.getByRole('button', { name: '▣ School' }).click()
  await expect(page.getByText(/Previewing route from the registered school/i)).toBeVisible()

  await page.getByRole('button', { name: 'Auto' }).click()
  await expect(page.getByText(/Uses the real schedule context/i)).toBeVisible()
})

test('employee detail closes by Escape and backdrop and does not leak between workspaces', async ({ page }) => {
  await openPerformance(page)
  const firstRow = page.locator('.wf4-row').first()
  await firstRow.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await firstRow.click()
  await expect(dialog).toBeVisible()
  await page.getByTestId('detail-dialog-backdrop').click({ position: { x: 10, y: 10 } })
  await expect(dialog).toBeHidden()

  await openCoverage(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('quality filter and manager detail expose the no-feedback state', async ({ page }) => {
  await openPerformance(page)
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  const filterDialog = page.getByRole('dialog', { name: 'Filters' })
  const qualityFilter = filterDialog.getByRole('combobox', { name: 'Quality', exact: true })
  await qualityFilter.click()
  await page.getByRole('listbox', { name: 'Quality' }).getByRole('option', { name: 'No feedback', exact: true }).click()
  await expect(qualityFilter).toContainText('No feedback')
  await filterDialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(filterDialog).toHaveCount(0)

  const rows = page.locator('.wf4-row')
  await expect(rows.first()).toBeVisible()
  const count = await rows.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i).locator('.wf-quality')).toContainText('No feedback yet')
  }
  await rows.first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Quality & feedback')).toBeVisible()
  await expect(dialog.getByText('No feedback', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Availability & school')).toBeVisible()
})

test('route planner supports type-ahead employee search', async ({ page }) => {
  await openCoverage(page)
  await chooseEmployee(page, 'Aisha')
  await expect(page.getByTestId('map-employee-card')).toContainText('Aisha Khan')
})

test('map employee card shows school schedule, owns route-origin overrides and closes cleanly', async ({ page }) => {
  await openCoverage(page)
  await chooseEmployee(page, 'Aisha')

  const card = page.getByTestId('map-employee-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('School')
  await expect(card).toContainText(/00:00–24:00/)
  await card.getByRole('button', { name: '⌂ Home' }).click()
  await expect(card).toContainText(/Previewing route from the employee home/i)
  await card.getByRole('button', { name: 'Auto' }).click()
  await expect(card).toContainText(/Uses the real schedule context/i)

  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
})

test('map employee card has an explicit close button', async ({ page }) => {
  await openCoverage(page)
  await chooseEmployee(page, 'Aoife')
  await page.getByRole('button', { name: 'Close selected employee' }).click()
  await expect(page.getByTestId('map-employee-card')).toHaveCount(0)
})

test('map employee card closes when clicking map background', async ({ page }) => {
  await openCoverage(page)
  await chooseEmployee(page, 'Aisha')
  await expect(page.getByTestId('map-employee-card')).toBeVisible()
  await page.locator('.coverage-map').dispatchEvent('click', { clientX: 12, clientY: 12 })
  await expect(page.getByTestId('map-employee-card')).toHaveCount(0)
})
