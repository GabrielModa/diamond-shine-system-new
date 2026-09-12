import { expect, test } from '@playwright/test'
import { loginAsEmployee, uniqueLabel } from './helpers/operational-scenario'

function localDate(offsetDays: number) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

test('temporary unavailability saves, survives reload and can be removed', async ({ page }) => {
  await loginAsEmployee(page)
  const reason = uniqueLabel('Profile planned unavailability')

  await page.goto('/profile')
  await page.getByRole('button', { name: '+ Add temporary change', exact: true }).click()
  await page.getByLabel('Unavailable from date', { exact: true }).fill(localDate(8))
  await page.getByLabel('Until date', { exact: true }).fill(localDate(8))
  await page.getByLabel('Reason (optional)', { exact: true }).fill(reason)
  await page.getByRole('button', { name: 'Save temporary change', exact: true }).click()

  await expect(page.getByRole('status')).toContainText('Planned change saved')
  const entry = page.locator('article').filter({ hasText: reason })
  await expect(entry).toBeVisible()

  await page.reload()
  await expect(page.locator('article').filter({ hasText: reason })).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('article').filter({ hasText: reason }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Temporary unavailability removed')
  await expect(page.getByText(reason, { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(page.getByText(reason, { exact: true })).toHaveCount(0)
})
