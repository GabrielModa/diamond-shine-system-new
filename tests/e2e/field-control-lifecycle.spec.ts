import { expect, test } from '@playwright/test'
import { api, cookieHeader, createClientWithPublishedService, loginAsAdmin, loginAsEmployee, uniqueLabel } from './helpers/operational-scenario'

type CapacityWindow = {
  start: string
  end: string
  availableUserIds: string[]
}

test('incident acknowledgement, progress and resolution persist', async ({ page }) => {
  await loginAsAdmin(page)

  const users = await api<Array<{ id: string; email: string }>>(page, '/api/users')
  const employee = users.find((user) => user.email === 'employee@ds.ie')
  expect(employee, 'Seed employee must exist for assigned field execution.').toBeTruthy()
  if (!employee) return

  // Choose a real free window instead of hard-coding one. Desktop and mobile
  // projects share the CI database, so the second project must see work created
  // by the first and move to another valid slot.
  const candidateHours = [13, 14, 15, 16, 17, 18]
  const candidateWindows = candidateHours.map((hour) => {
    const start = new Date(Date.now() + 21 * 86_400_000)
    start.setUTCHours(hour, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    return { hour, start, end }
  })
  const capacity = await api<{ windows: CapacityWindow[] }>(page, '/api/schedule-capacity', {
    windows: candidateWindows.map((window) => ({
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    })),
    userIds: [employee.id],
  })
  const freeIndex = capacity.windows.findIndex((window) => window.availableUserIds.includes(employee.id))
  expect(freeIndex, 'Seed employee needs a free field-control acceptance slot.').toBeGreaterThanOrEqual(0)
  if (freeIndex < 0) return

  const scenario = await createClientWithPublishedService(
    page,
    uniqueLabel('Field control client'),
    candidateWindows[freeIndex].hour,
  )
  const account = await api<{ upcomingVisits: Array<{ id: string }> }>(page, `/api/client-accounts/${scenario.client.id}`)
  const visitId = account.upcomingVisits[0].id

  const visit = await api<{ version: number }>(page, `/api/visits/${visitId}`)
  const assigned = await page.request.patch(`/api/visits/${visitId}`, {
    headers: { Cookie: await cookieHeader(page), 'Content-Type': 'application/json' },
    data: { version: visit.version, assigneeIds: [employee.id] },
  })
  expect(assigned.ok(), await assigned.text()).toBeTruthy()

  await loginAsEmployee(page)
  const incident = await api<{ id: string }>(page, `/api/visits/${visitId}/incidents`, {
    title: uniqueLabel('Access problem'),
    description: 'Reception key is missing',
    category: 'access',
    severity: 'medium',
  })

  await loginAsAdmin(page)
  async function open() {
    await page.goto('/field-control')
    await page.getByRole('button', { name: /^Incidents/ }).click()
  }

  await open()
  const card = page.locator(`[data-incident-id="${incident.id}"]`)
  for (const [button, state] of [['Acknowledge', 'acknowledged'], ['Mark in progress', 'in progress']] as const) {
    await card.getByRole('button', { name: button, exact: true }).click()
    await expect(card.locator('.field-v2-status')).toHaveText(state)
    await page.reload()
    await page.getByRole('button', { name: /^Incidents/ }).click()
    await expect(card.locator('.field-v2-status')).toHaveText(state)
  }

  await card.getByLabel('Manager note').fill('Reception supplied replacement key; access restored.')
  await card.getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(card).toBeHidden()

  await page.reload()
  await loginAsEmployee(page)
  const incidents = await api<Array<{ id: string; status: string; resolutionNotes: string | null }>>(page, `/api/visits/${visitId}/incidents`)
  expect(incidents.find((item) => item.id === incident.id)?.status).toBe('resolved')
})
