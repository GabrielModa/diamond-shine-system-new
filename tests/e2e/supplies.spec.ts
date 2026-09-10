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
  await page.goto('/supplies')
  await expect(page.getByRole('heading', { name: 'Supplies' })).toBeVisible()
  await page.getByRole('button', { name: 'New request', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Client site' })).toContainText(/.+/)
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await page.getByLabel('All-purpose cleaner requested quantity').first().fill('3')
  await page.getByLabel('Reason / delivery note').fill(note)
  await page.getByRole('button', { name: 'Request 1 material', exact: true }).click()
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
  await request.getByRole('button', { name: 'Open request' }).click()

  const detail = page.locator('#detailOverlay.overlay.active')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText(note)
  await expect(detail.getByLabel('Responsible')).toBeVisible()
  await expect(detail.getByRole('button', { name: /Triaged/ })).toBeVisible()
  await expect(detail.getByRole('button', { name: /Notify client/ })).toBeVisible()
})
