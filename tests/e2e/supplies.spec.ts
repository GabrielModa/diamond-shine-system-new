import { test, expect, type Page } from '@playwright/test'
import { prisma } from '../../src/lib/prisma'

test.afterEach(async () => {
  await prisma.supplyRequest.deleteMany({ where: { notes: { startsWith: 'E2E supply test:' } } })
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

test('full happy path: employee submits a supply request', async ({ page }) => {
  await login(page, 'employee@ds.ie')
  const note = `E2E supply test: ${Date.now()}`
  await page.goto('/my-requests')
  await expect(page.getByRole('heading', { name: 'My requests', exact: true, level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'New request', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Client site' })).toContainText(/.+/)
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await page.getByLabel('All-purpose cleaner requested quantity').first().fill('3')
  await page.getByLabel('Reason / delivery note').fill(note)
  await page.getByRole('button', { name: 'Submit request', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Material request created and routed to operations.')
  await expect(page.getByText(note)).toHaveCount(0)
})

test('manager processes a field request from the consolidated Supplies control', async ({ page }) => {
  await login(page, 'admin@ds.ie')
  const note = `E2E supply test: manager ${Date.now()}`
  const cookies = await page.context().cookies()
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join('; ')
  const created = await page.request.post('/api/supplies', {
    headers: { Cookie: cookie },
    data: {
      employeeName: 'Supply Control Employee',
      clientLocation: 'TechCorp Office - Dublin 2',
      priority: 'urgent',
      products: ['All-purpose cleaner'],
      notes: note,
    },
  })
  expect(created.status()).toBe(201)

  await page.goto('/supplies')
  await expect(page.getByRole('heading', { name: 'Supply requests' })).toBeVisible()
  await page.locator('button[data-priority="urgent"]').click()
  const request = page.locator('.request-row').filter({ hasText: 'Supply Control Employee' }).first()
  await expect(request).toBeVisible()
  await request.getByRole('button', { name: 'Open', exact: true }).click()

  const detail = page.locator('#detailOverlay.overlay.active')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText(note)
  await expect(detail.getByLabel('Responsible')).toBeVisible()
  await expect(detail.getByRole('button', { name: /Triaged/ })).toBeVisible()
  await expect(detail.getByRole('button', { name: /Notify client/ })).toBeVisible()
})


test('stock count stays count-only and does not present auto-request language', async ({ page }) => {
  await login(page, 'admin@ds.ie')
  await page.goto('/supplies')
  await page.getByRole('button', { name: 'Count stock', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Fast site count', exact: true })).toBeVisible()
  await expect(page.getByText('Count only', { exact: true })).toBeVisible()
  await expect(page.getByText('Count only · no supply request will be created', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save count', exact: true })).toBeVisible()
  await expect(page.getByText(/shortages detected/i)).toHaveCount(0)
  await expect(page.getByText(/auto-create request/i)).toHaveCount(0)
})

test('supplies overview keeps risk and request queue as bounded dashboard panels', async ({ page }) => {
  await login(page, 'admin@ds.ie')
  await page.goto('/supplies')

  const grid = page.locator('.materials-grid').first()
  const risk = page.getByTestId('stock-risk-card')
  const queue = page.getByTestId('request-queue-card')
  const viewport = page.getByTestId('request-queue-viewport')

  await expect(risk).toBeVisible()
  await expect(queue).toBeVisible()
  await expect(viewport).toBeVisible()

  expect(await grid.evaluate((element) => getComputedStyle(element).alignItems)).toBe('start')
  expect(await risk.evaluate((element) => getComputedStyle(element).alignSelf)).toBe('start')

  const queueHeight = await queue.evaluate((element) => element.getBoundingClientRect().height)
  const viewportLayout = await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))

  expect(queueHeight).toBeLessThanOrEqual(770)
  expect(viewportLayout.clientHeight).toBeLessThanOrEqual(575)
  expect(viewportLayout.overflowY).toBe('auto')
})
