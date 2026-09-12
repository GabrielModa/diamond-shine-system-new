import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const uniqueLabel = (prefix: string) => `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').fill('password123')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(/\/home/)
}
export const loginAsAdmin = (page: Page) => login(page, 'admin@ds.ie')
export const loginAsEmployee = (page: Page) => login(page, 'employee@ds.ie')

export async function api<T>(request: APIRequestContext, url: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get(url) : await request.post(url, { data })
  const body = await response.json()
  expect(response.ok(), JSON.stringify(body)).toBeTruthy()
  expect(body.ok).toBe(true)
  return body.data as T
}

export async function createOperationalClient(request: APIRequestContext, name = uniqueLabel('Acceptance client')) {
  return api<{ id: string; sites: Array<{ id: string }> }>(request, '/api/client-accounts', {
    client: { displayName: name, type: 'commercial' },
    location: { name, addressLine1: '1 Test Street', city: 'Dublin', postalCode: 'D02 XY12',
      countryCode: 'IE', timezone: 'Europe/Dublin', latitude: 53.3451, longitude: -6.2811,
      coordinateSource: 'geocoded', access: { entryInstructions: 'Use reception' } },
  })
}

export async function createClientWithPublishedService(request: APIRequestContext, name = uniqueLabel('Service client')) {
  const client = await createOperationalClient(request, name)
  const start = new Date(Date.now() + 21 * 86_400_000)
  start.setUTCHours(9, 0, 0, 0)
  const service = await api<{ servicePlanId: string; jobId: string }>(request, `/api/client-accounts/${client.id}/service`, {
    siteId: client.sites[0].id, serviceName: 'Acceptance cleaning', startAt: start.toISOString(),
    expectedDurationMinutes: 60, requiredWorkers: 1, tasks: ['Clean floors'],
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [start.getUTCDay()] },
  })
  return { client, service, name, date: start.toISOString().slice(0, 10) }
} 