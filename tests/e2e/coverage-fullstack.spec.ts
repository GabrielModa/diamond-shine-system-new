import { expect, test } from '@playwright/test'
import { addOperationalDays, operationalDateKey, operationalInputToUtc } from '../../src/lib/operational-time'
import { api, loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

test('Plan Coverage uses the real Schedule capacity engine for a real temporary restriction', async ({ page }) => {
  await loginAsAdmin(page)

  const users = await api<Array<{ id: string; email: string; name: string | null }>>(page.request, '/api/users')
  const employee = users.find((user) => user.email === 'employee@ds.ie')
  expect(employee, 'Seeded employee must exist for the real capacity acceptance path.').toBeTruthy()
  if (!employee) return

  const timezone = 'Europe/Dublin'
  const targetDate = addOperationalDays(operationalDateKey(new Date(), timezone), 1)
  const blockStart = operationalInputToUtc(`${targetDate}T14:00`, timezone)
  const blockEnd = operationalInputToUtc(`${targetDate}T19:00`, timezone)
  const reason = uniqueLabel('Capacity acceptance restriction')
  const availability = await api<{ id: string }>(page.request, '/api/availability', {
    userId: employee.id,
    startsAt: blockStart.toISOString(),
    endsAt: blockEnd.toISOString(),
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
    const employeeLabel = employee.name ?? employee.email
    await page.getByLabel('Search team member').fill(employeeLabel)
    await page.getByRole('listbox').getByRole('option', { name: new RegExp(employeeLabel) }).click()

    const status = page.locator('.route-planning-status')
    await expect(status).toContainText('Unavailable in this pattern')
    await expect(status).toContainText(reason)

    // Full-stack contract: the browser calls the real /api/schedule-capacity endpoint,
    // which reads the Availability created above through the public product API.
    const unavailable = page.getByRole('button', { name: /Unavailable/ })
    await expect(unavailable).toContainText(/1|2|3|4|5|6|7|8|9/)
    await unavailable.click()
    await expect(page.getByRole('combobox', { name: 'Choose team member' })).toContainText(employeeLabel)
  } finally {
    await page.request.delete(`/api/availability/${availability.id}`)
  }
})
