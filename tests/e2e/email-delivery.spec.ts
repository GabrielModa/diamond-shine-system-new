import { expect, test } from '@playwright/test'

test('admin can inspect delivery failures and run the email diagnostic', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await page.route('**/api/notifications', (route) => route.fulfill({ json: {
    ok: true, data: {
      counts: { queued: 2, failed: 1, exhausted: 3 },
      latestFailure: { kind: 'supply_alert', lastError: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)', lastAttemptAt: '2026-09-10T09:00:00Z' },
      items: [{ id: 'job', kind: 'supply_alert', status: 'failed', attempts: 1, maxAttempts: 5, lastError: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)' }],
    },
  } }))
  // Exercise the client flow without sending real email from browser tests.
  await page.route('**/api/notifications/test', (route) => route.fulfill({ status: 502, json: { ok: false, error: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)' } }))
  await page.goto('/communications')
  await page.getByRole('button', { name: 'Delivery settings', exact: true }).click()
  await expect(page.getByText('Queued 2', { exact: false })).toContainText('Exhausted 3')
  await expect(page.getByText('Latest failure:', { exact: false })).toContainText('SMTP 535')
  await page.getByRole('button', { name: 'Test email delivery', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('EAUTH')
  await page.route('**/api/notifications/test', (route) => route.fulfill({ json: { ok: true, data: { message: 'SMTP verified and test email accepted by the server. Check your inbox and spam folder to confirm receipt.' } } }))
  await page.getByRole('button', { name: 'Test email delivery', exact: true }).click()
  await expect(page.getByText('SMTP verified and test email accepted', { exact: false })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('delivery-settings.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
