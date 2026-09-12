import { expect, test } from '@playwright/test'
import { api, createClientWithPublishedService, loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

test('incident acknowledgement, progress and resolution persist', async ({ page }) => {
  await loginAsAdmin(page)
  const scenario = await createClientWithPublishedService(page)
  const account = await api<{ upcomingVisits: Array<{ id: string }> }>(page, `/api/client-accounts/${scenario.client.id}`)
  const visitId = account.upcomingVisits[0].id
  const incident = await api<{ id: string }>(page, `/api/visits/${visitId}/incidents`, {
    title: uniqueLabel('Access problem'), description: 'Reception key is missing', category: 'access', severity: 'medium',
  })
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
  const incidents = await api<Array<{ id: string; status: string; resolutionNotes: string | null }>>(page, `/api/visits/${visitId}/incidents`)
  expect(incidents.find(i => i.id === incident.id)?.status).toBe('resolved')
})