import { expect, test } from '@playwright/test'
import { addOperationalDays, operationalDateKey, operationalInputToUtc } from '../../src/lib/operational-time'
import { api, cookieHeader, loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

type CapacityWindow = {
  start: string
  end: string
  availableUserIds: string[]
}

test('Plan Coverage uses the real Schedule capacity engine for a real temporary restriction', async ({ page }) => {
  await loginAsAdmin(page)

  const users = await api<Array<{ id: string; email: string; name: string | null }>>(page, '/api/users')
  const employee = users.find((user) => user.email === 'employee@ds.ie')
  expect(employee, 'Seeded employee must exist for the real capacity acceptance path.').toBeTruthy()
  if (!employee) return

  const timezone = 'Europe/Dublin'
  const today = operationalDateKey(new Date(), timezone)
  const candidateTimes = [
    ['12:30', '13:30'],
    ['15:00', '16:00'],
    ['18:00', '19:00'],
  ] as const
  const candidates = Array.from({ length: 7 }, (_, index) => addOperationalDays(today, index + 1))
    .flatMap((date) => candidateTimes.map(([startTime, endTime]) => ({
      date,
      startTime,
      endTime,
      start: operationalInputToUtc(`${date}T${startTime}`, timezone),
      end: operationalInputToUtc(`${date}T${endTime}`, timezone),
    })))

  const capacity = await api<{ windows: CapacityWindow[] }>(page, '/api/schedule-capacity', {
    windows: candidates.map((candidate) => ({ start: candidate.start.toISOString(), end: candidate.end.toISOString() })),
    userIds: [employee.id],
  })
  const candidateIndex = capacity.windows.findIndex((window) => window.availableUserIds.includes(employee.id))
  expect(candidateIndex, 'The seeded employee needs one genuinely free slot in the next seven days.').toBeGreaterThanOrEqual(0)
  if (candidateIndex < 0) return

  const selected = candidates[candidateIndex]
  const targetDate = selected.date
  const reason = uniqueLabel('Capacity acceptance restriction')
  const availability = await api<{ id: string }>(page, '/api/availability', {
    userId: employee.id,
    startsAt: selected.start.toISOString(),
    endsAt: selected.end.toISOString(),
    reason,
  })

  try {
    const weekdayLong = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(operationalInputToUtc(`${targetDate}T12:00`, timezone))

    await page.goto('/people')
    await expect(page.getByRole('heading', { name: 'Plan coverage', level: 1 })).toBeVisible({ timeout: 15_000 })

    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    for (const day of weekdays) {
      const button = page.getByRole('button', { name: `Planning day ${day}` })
      const isSelected = await button.getAttribute('aria-pressed') === 'true'
      if (day === weekdayLong ? !isSelected : isSelected) await button.click()
    }

    await page.getByLabel('Planning start time').fill(selected.startTime)
    await page.getByLabel('Planning end time').fill(selected.endTime)
    await page.getByRole('button', { name: '7 days', exact: true }).click()

    await expect(page.locator('.coverage-pattern-summary')).toContainText('1 schedule slot')
    await expect(page.getByText('Checking schedule…')).toBeHidden({ timeout: 15_000 })

    const team = page.getByRole('combobox', { name: 'Choose team member' })
    await team.click()
    const employeeLabel = employee.name ?? employee.email
    await page.getByLabel('Search team member').fill(employeeLabel)
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(employeeLabel) }).click()

    const status = page.locator('.route-planning-status')
    await expect(status).toContainText('Unavailable in this pattern')
    await expect(status).toContainText(reason)

    // Full-stack contract: the browser calls the real /api/schedule-capacity endpoint,
    // which now reads the exact temporary Availability created above in a slot that
    // was verified free before the blocker was inserted.
    const unavailable = page.getByRole('button', { name: /Unavailable/ })
    await expect(unavailable).toContainText(/1|2|3|4|5|6|7|8|9/)
    await unavailable.click()
    await expect(page.getByRole('combobox', { name: 'Choose team member' })).toContainText(employeeLabel)
  } finally {
    const cleanup = await page.request.delete(`/api/availability/${availability.id}`, {
      headers: { Cookie: await cookieHeader(page) },
    })
    expect(cleanup.ok()).toBeTruthy()
  }
})
