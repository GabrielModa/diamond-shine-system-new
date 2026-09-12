import { expect, test } from '@playwright/test'
import { loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

test('disposable invitation role persists and can be deleted without touching core actors', async ({ page }) => {
  await loginAsAdmin(page)

  const suffix = uniqueLabel('access').replace(/[^a-z0-9]/gi, '').toLowerCase()
  const email = `${suffix}@test.io`
  const name = `Disposable Access ${suffix.slice(-8)}`

  await page.goto('/users')
  await page.getByLabel('Full name', { exact: true }).fill(name)
  await page.getByLabel('Work email', { exact: true }).fill(email)
  await page.getByLabel('Operational role', { exact: true }).selectOption('employee')
  await page.getByRole('button', { name: 'Send invitation', exact: true }).click()

  const row = page.locator('.access-user-row').filter({ hasText: email })
  await expect(row).toHaveCount(1, { timeout: 15_000 })
  await expect(row).toContainText('Pending')

  // Role mutations are intentionally performed only on this disposable invitation.
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('combobox', { name: `Role for ${name}` }).selectOption('viewer')
  await expect(page.getByRole('status')).toContainText('Role changed to Viewer')
  await expect(row.getByRole('combobox', { name: `Role for ${name}` })).toHaveValue('viewer')

  await page.reload()
  const persistedRow = page.locator('.access-user-row').filter({ hasText: email })
  await expect(persistedRow).toHaveCount(1)
  await expect(persistedRow.getByRole('combobox', { name: `Role for ${name}` })).toHaveValue('viewer')

  await persistedRow.getByRole('button', { name: 'Delete invitation…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete this invitation?' })
  await dialog.getByLabel('Confirm work email', { exact: true }).fill(email)
  await dialog.getByRole('button', { name: 'Delete invitation permanently', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Pending invitation permanently deleted')
  await expect(page.locator('.access-user-row').filter({ hasText: email })).toHaveCount(0)

  await page.reload()
  await expect(page.locator('.access-user-row').filter({ hasText: email })).toHaveCount(0)
  await expect(page.getByText('admin@ds.ie', { exact: true })).toBeVisible()
  await expect(page.getByText('employee@ds.ie', { exact: true })).toBeVisible()
})
