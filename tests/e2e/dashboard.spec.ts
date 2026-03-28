import { test, expect } from '@playwright/test'

async function getCookieHeader(page: any) {
  const cookies = await page.context().cookies()
  return cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; ')
}

async function createSupply(page: any, payload: any) {
  const cookie = await getCookieHeader(page)
  const res = await page.request.post('/api/supplies', {
    data: payload,
    headers: { Cookie: cookie },
  })
  const json = await res.json()
  return json.data.id as string
}

async function updateStatus(page: any, id: string, status: string) {
  const cookie = await getCookieHeader(page)
  await page.request.patch(`/api/supplies/${id}/status`, {
    data: { status },
    headers: { Cookie: cookie },
  })
}

async function createFeedback(page: any, payload: any) {
  const cookie = await getCookieHeader(page)
  await page.request.post('/api/feedback', {
    data: payload,
    headers: { Cookie: cookie },
  })
}

async function waitForDashboardCards(page: any) {
  await page.waitForSelector('.stat-card.urgent', { state: 'visible' })
  await page.waitForSelector('.stat-card.normal', { state: 'visible' })
  await page.waitForSelector('.stat-card.low', { state: 'visible' })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('dashboard loads with Urgent, Normal and Low stat cards', async ({ page }) => {
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await expect(page.locator('[data-testid="stat-urgent"]')).toBeVisible()
  await expect(page.locator('[data-testid="stat-normal"]')).toBeVisible()
  await expect(page.locator('[data-testid="stat-low"]')).toBeVisible()
})

test('clicking Urgent card opens filtered list with only pending urgent items', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Urgent Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    priority: 'urgent',
    products: ['All-purpose cleaner', 'Rubber gloves'],
  })

  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.urgent')
  await expect(page.locator('#listOverlay.overlay.active')).toBeVisible()
  const total = await page.locator('.list-item').count()
  await expect(page.locator('.list-item .badge.urgent')).toHaveCount(total)
  await expect(page.locator('.list-item .status-badge.Pending')).toHaveCount(total)
})

test('clicking a list item opens the detail sheet with correct data', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Detail Employee',
    clientLocation: 'Green Bank - Temple Bar',
    priority: 'normal',
    products: ['Toilet paper'],
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.normal')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await expect(page.locator('#detailOverlay.overlay.active')).toBeVisible()
  await expect(page.locator('#detailOverlay [data-testid="supply-detail"]')).toBeVisible()
  await expect(page.locator('#detailOverlay')).toContainText('Detail Employee')
  await expect(page.locator('#detailOverlay')).toContainText('Green Bank - Temple Bar')
})

test('clicking Send Email opens modal with pre-filled subject and body', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Email Employee',
    clientLocation: 'Blue Industries - Ballsbridge',
    priority: 'urgent',
    products: ['Bleach', 'Bin bags'],
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.urgent')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await page.click('button:has-text("Send Email to Client")')
  await expect(page.locator('#emailModal.modal-overlay.active')).toBeVisible()
  const subject = await page.inputValue('#emailSubject')
  const body = await page.inputValue('#emailBody')
  expect(subject).toContain('Diamond Shine Supplies')
  expect(subject).toContain('URGENT')
  expect(body).toContain('Diamond Shine')
})

test('completing a Pending request shows ONE confirm modal with email warning', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Pending Employee',
    clientLocation: 'Red Company - Dun Laoghaire',
    priority: 'low',
    products: ['Paper towels'],
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.low')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await page.click('button:has-text("Complete Without Email")')
  await expect(page.locator('#confirmModal.modal-overlay.active')).toBeVisible()
  await expect(page.locator('#confirmMessage')).toContainText('has not been emailed')
  await expect(page.locator('#confirmModal.modal-overlay.active')).toHaveCount(1)
})

test('completing an Email Sent request shows ONE confirm modal without email warning', async ({ page }) => {
  const id = await createSupply(page, {
    employeeName: 'Email Sent Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    priority: 'urgent',
    products: ['Microfiber cloths'],
  })
  await updateStatus(page, id, 'Email Sent')
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.status-pill:has-text("Email Sent")')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await page.click('button:has-text("Mark as Completed")')
  await expect(page.locator('#confirmModal.modal-overlay.active')).toBeVisible()
  await expect(page.locator('#confirmMessage')).toContainText('Mark as completed')
  await expect(page.locator('#confirmMessage')).not.toContainText('not been emailed')
  await expect(page.locator('#confirmModal.modal-overlay.active')).toHaveCount(1)
})

test('searching an employee shows their profile with evaluations', async ({ page }) => {
  await createFeedback(page, {
    employeeName: 'Sarah Johnson',
    clientLocation: 'TechCorp Office - Dublin 2',
    cleanliness: 4.5,
    punctuality: 4.5,
    equipment: 5.0,
    clientRelations: 4.5,
    comments: 'Great work',
  })
  await createFeedback(page, {
    employeeName: 'Sam Keane',
    clientLocation: 'Green Bank - Temple Bar',
    cleanliness: 4.0,
    punctuality: 4.0,
    equipment: 4.0,
    clientRelations: 4.0,
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.fill('input[placeholder="Search employee..."]', 'sa')
  await expect(page.locator('.found-count')).toContainText('Found')
  await page.click('.result-row:has-text("Sarah Johnson")')
  await expect(page.locator('text=👤 Sarah Johnson')).toBeVisible()
})

test('clicking an evaluation in employee profile opens Feedback Detail', async ({ page }) => {
  await createFeedback(page, {
    employeeName: 'Sarah Johnson',
    clientLocation: 'TechCorp Office - Dublin 2',
    cleanliness: 4.5,
    punctuality: 4.5,
    equipment: 5.0,
    clientRelations: 4.5,
    comments: 'Great work',
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.fill('input[placeholder="Search employee..."]', 'sa')
  await page.click('.result-row:has-text("Sarah Johnson")')
  await page.click('.profile-item')
  await expect(page.locator('#detailOverlay.overlay.active')).toBeVisible()
  await expect(page.locator('text=⭐ Evaluation')).toBeVisible()
})

test('ESC closes detail but not list (stack behavior)', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Stack Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    priority: 'urgent',
    products: ['Bleach'],
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.urgent')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await page.keyboard.press('Escape')
  await expect(page.locator('#detailOverlay.overlay.active')).toHaveCount(0)
  await expect(page.locator('#listOverlay.overlay.active')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#listOverlay.overlay.active')).toHaveCount(0)
})

test('browser back closes topmost overlay only', async ({ page }) => {
  await createSupply(page, {
    employeeName: 'Back Employee',
    clientLocation: 'TechCorp Office - Dublin 2',
    priority: 'urgent',
    products: ['Bleach'],
  })
  await page.goto('/dashboard')
  await waitForDashboardCards(page)
  await page.click('.stat-card.urgent')
  await page.waitForSelector('#listOverlay.overlay.active .list-item')
  await page.click('#listOverlay.overlay.active .list-item')
  await page.goBack()
  await expect(page.locator('#detailOverlay.overlay.active')).toHaveCount(0)
  await expect(page.locator('#listOverlay.overlay.active')).toBeVisible()
})
