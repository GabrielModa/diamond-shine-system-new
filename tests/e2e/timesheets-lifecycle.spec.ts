import { expect, test } from '@playwright/test'
import { loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

test('payroll approval and adjustment survive reload without changing recorded time', async ({ page }) => {
  await loginAsAdmin(page)

  const endedAt = new Date(Date.now() - 60 * 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  const mutationId = uniqueLabel('acceptance-payroll').replaceAll(' ', '-').toLowerCase()

  const started = await page.request.post('/api/time-entries', {
    data: {
      kind: 'office',
      startedAt: startedAt.toISOString(),
      source: 'e2e-acceptance',
      clientMutationId: mutationId,
    },
  })
  const startedBody = await started.json()
  expect(started.ok(), JSON.stringify(startedBody)).toBeTruthy()
  expect(startedBody.ok).toBe(true)
  const entry = startedBody.data as { id: string }

  const stopped = await page.request.post(`/api/time-entries/${entry.id}/stop`, {
    data: {
      endedAt: endedAt.toISOString(),
      source: 'e2e-acceptance',
    },
  })
  const stoppedBody = await stopped.json()
  expect(stopped.ok(), JSON.stringify(stoppedBody)).toBeTruthy()
  expect(stoppedBody.data.status).toBe('completed')

  async function isolateEntry() {
    await page.getByPlaceholder('Search employee, site or work…').fill(entry.id)
    const row = page.locator('.ts-row')
    await expect(row).toHaveCount(1)
    return row
  }

  await page.goto('/timesheets')
  let row = await isolateEntry()
  await expect(row).toContainText('1h')
  await row.getByRole('button', { name: 'Review payroll', exact: true }).click()

  let dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1h')
  await dialog.getByRole('button', { name: 'Approve full', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save payroll decision', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('full recorded time is payable')

  await page.reload()
  row = await isolateEntry()
  await expect(row).toContainText('Approved')
  await row.getByRole('button', { name: 'Adjust payroll', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Already payroll-ready')
  await expect(dialog).toContainText('1h')

  await dialog.getByRole('button', { name: 'Adjust & approve', exact: true }).click()
  await dialog.getByLabel('Hours').fill('0')
  await dialog.getByLabel('Minutes').fill('30')

  // An adjustment without a reason must not fake success or close the decision.
  await dialog.getByRole('button', { name: 'Save payroll decision', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Add a reason')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Reason (required)').fill('Exclude 30 minutes of non-payable waiting time.')
  await dialog.getByRole('button', { name: 'Save payroll decision', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('30m payable')

  await page.reload()
  row = await isolateEntry()
  await expect(row).toContainText('Approved')
  await row.getByRole('button', { name: 'Adjust payroll', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('30m')
  await expect(dialog.getByLabel('Hours')).toHaveValue('0')
  await expect(dialog.getByLabel('Minutes')).toHaveValue('30')

  const persistedResponse = await page.request.get(`/api/time-entries/${entry.id}`)
  expect(persistedResponse.ok()).toBe(true)
  const persisted = (await persistedResponse.json()).data
  expect(persisted.durationSeconds).toBe(3600)
  expect(persisted.payableSeconds).toBe(1800)
  expect(persisted.status).toBe('approved')
})
