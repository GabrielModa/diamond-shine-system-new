import { expect, test } from '@playwright/test'
import { loginAsAdmin, loginAsEmployee, uniqueLabel } from './helpers/operational-scenario'

test('employee acknowledgement persists and reaches manager tracking', async ({ page, browser }) => {
  await loginAsAdmin(page)
  const title = uniqueLabel('Acceptance notice')
  await page.goto('/communications')
  await page.getByRole('button', { name: 'Broadcast', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Message', { exact: true }).fill('Please confirm receipt of the revised access instructions.')
  await page.getByLabel('Require acknowledgement').check()
  await page.getByLabel('Search recipients').fill('employee@ds.ie')
  await page.getByRole('checkbox', { name: /employee@ds.ie/ }).check()
  await page.getByRole('button', { name: 'Publish & track acknowledgement' }).click()
  const tracking = page.locator('.tracking-card').filter({ hasText: title })
  await expect(tracking).toContainText('0/1 acknowledged')
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const employee = await context.newPage()
    await loginAsEmployee(employee)
    await employee.goto('/communications')
    const notice = employee.locator('.inbox-message').filter({ hasText: title })
    await notice.getByRole('button', { name: 'Acknowledge', exact: true }).click()
    await expect(notice).toContainText('Acknowledged')
    await employee.reload()
    await expect(notice).toContainText('Acknowledged')
    await page.reload()
    await page.getByRole('button', { name: 'Acknowledgements', exact: true }).click()
    await expect(tracking).toContainText('1/1 acknowledged')
  } finally { await context.close() }
})