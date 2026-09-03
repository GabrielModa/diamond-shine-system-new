import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

async function createFeedback(page: Page, comment: string, score = 5) {
  const employeesResponse = await page.request.get('/api/employees')
  expect(employeesResponse.ok()).toBe(true)
  const employeesPayload = await employeesResponse.json()
  const employee = employeesPayload.data.find((item: { email: string }) => item.email === 'employee@ds.ie') ?? employeesPayload.data[0]
  expect(employee?.id).toBeTruthy()

  const response = await page.request.post('/api/feedback', {
    data: {
      employeeId: employee.id,
      clientLocation: 'Feedback E2E · Dublin',
      cleanliness: score,
      punctuality: score,
      equipment: score,
      clientRelations: score,
      comments: comment,
    },
  })
  expect(response.status()).toBe(201)
}

test('service feedback is a dedicated client-experience workspace', async ({ page }) => {
  await login(page, 'super@ds.ie')
  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Service feedback', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Feedback summary' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Feedback history', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Quality control' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New inspection' })).toHaveCount(0)
})

test('feedback filters recalculate the summary and preserve the exact evaluation detail', async ({ page }) => {
  await login(page, 'super@ds.ie')
  const marker = `feedback-e2e-${Date.now()}`
  await createFeedback(page, marker, 5)

  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })
  const search = page.getByPlaceholder('Employee, location or comment…')
  await search.fill(marker)

  const summary = page.getByRole('region', { name: 'Feedback summary' })
  await expect(page.getByText(/1 of \d+ evaluations/)).toBeVisible()
  await expect(summary.locator('article').filter({ hasText: 'Average rating' }).locator('strong')).toHaveText('5.0')
  await expect(summary.locator('article').filter({ hasText: 'Cleanliness' }).locator('strong')).toHaveText('5.0')
  await expect(summary.locator('article').filter({ hasText: 'Client relations' }).locator('strong')).toHaveText('5.0')
  await expect(summary.locator('article').filter({ hasText: 'Needs attention' }).locator('strong')).toHaveText('0')

  const row = page.locator('button').filter({ hasText: marker }).first()
  await expect(row).toBeVisible()
  await row.click()

  const detail = page.getByRole('dialog', { name: /Evaluation/i })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Feedback E2E · Dublin')
  await expect(detail).toContainText('5.0')
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toHaveCount(0)

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
})

test('employees cannot open the manager feedback workspace', async ({ page }) => {
  await login(page, 'employee@ds.ie')
  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/forbidden$/)
})
