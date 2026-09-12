import { expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/prisma'
import { addOperationalDays, operationalDateKey, operationalInputToUtc } from '../../src/lib/operational-time'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'
import { loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

const cleanupUserIds: string[] = []

test.afterEach(async () => {
  if (!cleanupUserIds.length) return
  const userIds = cleanupUserIds.splice(0)
  await prisma.availability.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
})

test.afterAll(async () => {
  await prisma.$disconnect()
})

test('Plan Coverage uses the real Schedule capacity engine for a real temporary restriction', async ({ page }) => {
  await loginAsAdmin(page)

  const name = uniqueLabel('Coverage Blocked')
  const user = await prisma.user.create({
    data: {
      email: `coverage-${Date.now()}@example.test`,
      name,
      role: 'employee',
      status: 'active',
      memberships: {
        create: {
          organizationId: LEGACY_ORGANIZATION_ID,
          role: 'employee',
          status: 'active',
        },
      },
      workforceProfile: {
        create: {
          organizationId: LEGACY_ORGANIZATION_ID,
          homeAddress: '1 Capacity Test Street, Dublin',
          homeLatitude: 53.3451,
          homeLongitude: -6.2811,
          travelMode: 'transit',
          weeklyTargetMinutes: 1800,
          weeklyTargetConfigured: true,
        },
      },
    },
  })
  cleanupUserIds.push(user.id)

  const timezone = 'Europe/Dublin'
  const targetDate = addOperationalDays(operationalDateKey(new Date(), timezone), 1)
  const blockStart = operationalInputToUtc(`${targetDate}T14:00`, timezone)
  const blockEnd = operationalInputToUtc(`${targetDate}T19:00`, timezone)
  const reason = uniqueLabel('Capacity acceptance restriction')

  await prisma.availability.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: user.id,
      startsAt: blockStart,
      endsAt: blockEnd,
      reason,
    },
  })

  const weekdayLong = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(operationalInputToUtc(`${targetDate}T12:00`, timezone))

  await page.goto('/people')
  await expect(page.getByRole('heading', { name: 'Plan coverage', level: 1 })).toBeVisible({ timeout: 15_000 })

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  for (const day of weekdays) {
    const button = page.getByRole('button', { name: `Planning day ${day}` })
    const selected = await button.getAttribute('aria-pressed') === 'true'
    if (day === weekdayLong ? !selected : selected) await button.click()
  }

  await page.getByLabel('Planning start time').fill('15:00')
  await page.getByLabel('Planning end time').fill('18:00')
  await page.getByRole('button', { name: '7 days', exact: true }).click()

  await expect(page.locator('.coverage-pattern-summary')).toContainText('1 schedule slot')
  await expect(page.getByText('Checking schedule…')).toBeHidden({ timeout: 15_000 })

  const team = page.getByRole('combobox', { name: 'Choose team member' })
  await team.click()
  await page.getByLabel('Search team member').fill(name)
  await page.getByRole('listbox').getByRole('option', { name: new RegExp(name) }).click()

  const status = page.locator('.route-planning-status')
  await expect(status).toContainText('Unavailable in this pattern')
  await expect(status).toContainText(reason)

  // This assertion is the full-stack contract: the browser request went through
  // the real /api/schedule-capacity endpoint and surfaced the DB restriction.
  const unavailable = page.getByRole('button', { name: /Unavailable/ })
  await expect(unavailable).toContainText(/1|2|3|4|5|6|7|8|9/)
  await unavailable.click()
  await expect(page.getByRole('combobox', { name: 'Choose team member' })).toContainText(name)
})
