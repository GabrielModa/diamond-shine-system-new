import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'employee@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('full happy path: employee submits a supply request', async ({ page }) => {
  await page.goto('/supplies')
  await expect(page.getByRole('heading', { name: 'Materials control' })).toBeVisible()
  await page.getByRole('button', { name: 'Request', exact: true }).click()
  await expect(page.getByLabel('Client site')).toHaveValue(/.+/)
  await page.getByRole('button', { name: 'normal', exact: true }).click()
  await page.getByLabel('All-purpose cleaner requested quantity').first().fill('3')
  await page.getByLabel('Reason / delivery note').fill('Unexpected usage after a client event.')
  await page.getByRole('button', { name: 'Request 1 material', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Material request created and routed to operations.')
  await expect(page.getByText('Unexpected usage after a client event.')).toHaveCount(0)
})
