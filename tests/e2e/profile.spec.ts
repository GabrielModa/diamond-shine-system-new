import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'employee@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await page.goto('/profile', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
})

test('profile editors open and cancel without losing the saved sections', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit contact' }).click()
  await expect(page.getByRole('button', { name: 'Save contact' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).first().click()

  await page.getByRole('button', { name: 'Edit home & travel' }).click()
  await expect(page.getByRole('button', { name: 'Save home & travel' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).first().click()

  await page.getByRole('button', { name: 'Edit school & study' }).click()
  await expect(page.getByRole('button', { name: 'Save school & study' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).first().click()

  await page.getByRole('button', { name: 'Edit normal week' }).click()
  await expect(page.getByRole('button', { name: 'Save normal week' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).first().click()

  await page.getByRole('button', { name: '+ Add temporary change' }).click()
  await expect(page.getByRole('button', { name: 'Save temporary change' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).last().click()
})
