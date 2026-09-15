import { expect, test } from '@playwright/test'

test('admin can inspect delivery failures and run the email diagnostic', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)

  await page.route('**/api/notifications', (route) => route.fulfill({ json: {
    ok: true,
    data: {
      counts: { queued: 2, failed: 1, exhausted: 3 },
      latestFailure: {
        kind: 'supply_alert',
        lastError: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)',
        lastAttemptAt: '2026-09-10T09:00:00Z',
      },
      items: [{
        id: 'job',
        kind: 'supply_alert',
        status: 'failed',
        attempts: 1,
        maxAttempts: 5,
        lastError: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)',
      }],
    },
  } }))

  // Exercise the client flow without sending real email from browser tests.
  await page.route('**/api/notifications/test', (route) => route.fulfill({
    status: 502,
    json: {
      ok: false,
      error: 'EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)',
      data: {
        recipient: 'admin@ds.ie',
        checks: { smtpVerified: false, recipientAccepted: false },
      },
    },
  }))

  await page.goto('/communications')
  await page.getByRole('button', { name: 'Delivery settings', exact: true }).click()

  const metrics = page.locator('.delivery-queue-metrics')
  await expect(metrics).toContainText('2')
  await expect(metrics).toContainText('Queued')
  await expect(metrics).toContainText('3')
  await expect(metrics).toContainText('Exhausted')
  await expect(page.locator('.delivery-latest-failure')).toContainText('SMTP 535')

  await page.getByRole('button', { name: /Test delivery/ }).click()
  const dialog = page.getByRole('dialog', { name: /Delivery test needs attention/ })
  await expect(dialog).toContainText('EAUTH')
  await expect(dialog).toContainText('Could not verify')

  await page.unroute('**/api/notifications/test')
  await page.route('**/api/notifications/test', (route) => route.fulfill({
    json: {
      ok: true,
      data: {
        message: 'SMTP verified and the sending server accepted the test message for delivery. Inbox placement is not confirmed automatically; check inbox and spam.',
        recipient: 'admin@ds.ie',
        messageId: '<e2e-diagnostic@diamondshine.ie>',
        checks: { smtpVerified: true, recipientAccepted: true },
      },
    },
  }))

  await dialog.getByRole('button', { name: 'Run again', exact: true }).click()
  const passed = page.getByRole('dialog', { name: /Email accepted for delivery/ })
  await expect(passed).toContainText('Verified successfully')
  await expect(passed).toContainText('Accepted by the mail server')
  await expect(passed).toContainText('Not confirmed automatically')
  await expect(passed).toContainText('<e2e-diagnostic@diamondshine.ie>')
  await expect(passed).toContainText('does not prove Gmail placed it in the inbox')
  await passed.getByRole('button', { name: 'Close', exact: true }).click()

  await page.screenshot({ path: testInfo.outputPath('delivery-settings.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
