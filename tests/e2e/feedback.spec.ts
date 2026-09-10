import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

async function getCookieHeader(page: Page) {
  const cookies = await page.context().cookies()
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function createFeedback(page: Page, comment: string, score = 5) {
  const cookie = await getCookieHeader(page)
  const employeesResponse = await page.request.get('/api/employees', { headers: { Cookie: cookie } })
  expect(employeesResponse.ok()).toBe(true)
  const employeesPayload = await employeesResponse.json()
  const employee = employeesPayload.data.find((item: { email: string }) => item.email === 'employee@ds.ie') ?? employeesPayload.data[0]
  expect(employee?.id).toBeTruthy()

  const response = await page.request.post('/api/feedback', {
    headers: { Cookie: cookie },
    data: {
      employeeId: employee.id,
      clientLocation: 'TechCorp Office - Dublin 2',
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
  await expect(page.getByRole('region', { name: 'Service performance by employee' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Feedback history', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /Feedback history/ }).click()
  await expect(page.getByRole('dialog', { name: 'Feedback history' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Quality control' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New inspection' })).toHaveCount(0)
})

test('feedback filters recalculate the summary and preserve the exact evaluation detail', async ({ page }) => {
  await login(page, 'super@ds.ie')
  const marker = `feedback-e2e-${Date.now()}`
  await createFeedback(page, marker, 5)

  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Feedback history/ }).click()
  const history = page.getByRole('dialog', { name: 'Feedback history' })
  const search = history.getByPlaceholder('Employee, location or comment…')
  await search.fill(marker)

  await expect(history.getByText('1 evaluation', { exact: true })).toBeVisible()

  const row = history.locator('button').filter({ hasText: marker }).first()
  await expect(row).toBeVisible()
  await row.click()

  const detail = page.getByRole('dialog', { name: /Evaluation/i })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('TechCorp Office - Dublin 2')
  await expect(detail).toContainText('5.0')
  await detail.getByRole('button', { name: 'Close' }).click()
  await expect(detail).toHaveCount(0)

  await history.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
})

test('needs attention filters the employee performance list without opening history', async ({ page }) => {
  await login(page, 'super@ds.ie')
  const marker = `attention-e2e-${Date.now()}`
  await createFeedback(page, marker, 3)

  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })
  const attention = page.getByRole('button', { name: /Needs attention/ })
  await expect(attention).toBeVisible()
  await attention.click()
  await expect(attention).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('dialog', { name: /Feedback history/ })).toHaveCount(0)
})

test('employees cannot open the manager feedback workspace', async ({ page }) => {
  await login(page, 'employee@ds.ie')
  await page.goto('/feedback', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/forbidden$/)
})
