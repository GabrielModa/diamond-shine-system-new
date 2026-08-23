import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('manager can move through the operational control centre', async ({ page }) => {
  await expect(page.getByText('Operations command centre')).toBeVisible()

  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Clients', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'All clients', exact: true, level: 2 })).toBeVisible()

  await page.goto('/work-orders')
  await expect(page.getByRole('heading', { name: 'Work orders', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Work order register', exact: true, level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Active' })).toBeVisible()

  await page.goto('/schedule')
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Week' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()

  await page.goto('/quality')
  await expect(page.getByRole('heading', { name: 'Quality control', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Control centre' })).toBeVisible()

  await page.goto('/timesheets')
  await expect(page.getByRole('heading', { name: 'Timesheets', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: /Review time/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Payroll preview' })).toBeVisible()
})
