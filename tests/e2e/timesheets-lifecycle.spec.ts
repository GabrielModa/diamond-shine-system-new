import { afterEach, expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/prisma'
import { loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

const createdEntryIds: string[] = []

afterEach(async () => {
  if (createdEntryIds.length) {
    await prisma.timeEntry.deleteMany({ where: { id: { in: createdEntryIds.splice(0) } } })
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test('payroll approval and adjustment survive reload without changing recorded time', async ({ page }) => {
  await loginAsAdmin(page)
  const employee = await prisma.user.findUniqueOrThrow({
    where: { email: 'employee@ds.ie' },
    include: { memberships: { where: { status: 'active' }, take: 1 } },
  })
  const marker = uniqueLabel('Acceptance payroll')
  const endedAt = new Date(Date.now() - 60 * 60_000)
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000)
  const entry = await prisma.timeEntry.create({
    data: {
      organizationId: employee.memberships[0].organizationId,
      userId: employee.id,
      kind: 'office',
      status: 'completed',
      startedAt,
      endedAt,
      durationSeconds: 3600,
      reviewReason: marker,
      source: 'e2e-acceptance',
    },
  })
  createdEntryIds.push(entry.id)

  await page.goto('/timesheets')
  const row = page.locator('.ts-row').filter({ hasText: marker.toLowerCase() })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Review payroll', exact: true }).click()

  let dialog = page.getByRole('dialog', { name: /Employee|employee@ds.ie/i })
  await expect(dialog).toContainText('1h')
  await dialog.getByRole('button', { name: 'Approve full', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save payroll decision', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('full recorded time is payable')

  await page.reload()
  await expect(row).toContainText('Approved')
  await row.getByRole('button', { name: 'Adjust payroll', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /Employee|employee@ds.ie/i })
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
  await expect(row).toContainText('Approved')
  await row.getByRole('button', { name: 'Adjust payroll', exact: true }).click()
  dialog = page.getByRole('dialog', { name: /Employee|employee@ds.ie/i })
  await expect(dialog).toContainText('30m')
  await expect(dialog.getByLabel('Hours')).toHaveValue('0')
  await expect(dialog.getByLabel('Minutes')).toHaveValue('30')

  const persisted = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })
  expect(persisted.durationSeconds).toBe(3600)
  expect(persisted.payableSeconds).toBe(1800)
  expect(persisted.status).toBe('approved')
})
