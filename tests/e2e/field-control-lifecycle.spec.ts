import { expect, test } from '@playwright/test'
import { api, cookieHeader, createClientWithPublishedService, loginAsAdmin, loginAsEmployee, uniqueLabel } from './helpers/operational-scenario'

test('incident acknowledgement, progress and resolution persist', async ({ page }) => {
  await loginAsAdmin(page)
  const scenario = await createClientWithPublishedService(page)
  const account = await api<{ upcomingVisits: Array<{ id: string }> }>(page, `/api/client-accounts/${scenario.client.id}`)
  const visitId = account.upcomingVisits[0].id
  const users = await api<Array<{ id: string; email: string }>>(page, '/api/users')
  const employee = users.find((user) => user.email === 'employee@ds.ie')
  expect(employee, 'Seed employee must exist for assigned field execution.').toBeTruthy()
  if (!employee) return

  const visit = await api<{ version: number }>(page, `/api/visits/${visitId}`)
  const assigned = await page.request.patch(`/api/visits/${visitId}`, {
    headers: { Cookie: await cookieHeader(page), 'Content-Type': 'application/json' },
    data: { version: visit.version, assigneeIds: [employee.id] },
  })
  expect(assigned.ok(), await assigned.text()).toBeTruthy()

  await loginAsEmployee(page)
  const incident = await api<{ id: string }>(page, `/api/visits/${visitId}/incidents`, {
    title: uniqueLabel('Access problem'), description: 'Reception key is missing', category: 'access', severity: 'medium',
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
  expect(incidents.find(i => i.id === incident.id)?.status).toBe('resolved')
})