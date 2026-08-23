import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test('admin builds the operational chain from client to contract and area', async ({ page }) => {
  const suffix = `${Date.now()}`
  const clientName = `E2E Facilities ${suffix}`
  const siteName = `E2E Office ${suffix}`
  const areaName = `Boardroom ${suffix}`
  const contractName = `Cleaning Agreement ${suffix}`

  await page.goto('/operations')
  await expect(page.getByRole('heading', { name: 'Clients, contracts, sites & service plans' })).toBeVisible()
  await page.getByLabel('Display name').fill(clientName)
  await page.getByLabel('Legal name').fill(`${clientName} Ltd`)
  await page.getByRole('button', { name: 'Create client' }).click()
  await expect(page.getByRole('status')).toContainText('Client created')

  await page.getByRole('button', { name: 'Sites & areas' }).click()
  await page.getByLabel('Client').selectOption({ label: clientName })
  await page.getByLabel('Site name').fill(siteName)
  await page.getByLabel('Address').fill('10 Automation Street')
  await page.getByLabel('Postcode').fill('D02 E2E')
  await page.getByRole('button', { name: 'Create site' }).click()
  await expect(page.getByRole('status')).toContainText('Site created')

  await page.getByRole('button', { name: new RegExp(siteName) }).click()
  await page.getByLabel('Area name').fill(areaName)
  await page.getByLabel('Type').selectOption('room')
  await page.getByLabel('Code', { exact: true }).fill(`ROOM-${suffix}`)
  await page.getByRole('button', { name: 'Add area' }).click()
  await expect(page.getByRole('status')).toContainText('Operational area added')
  await expect(page.getByText(areaName)).toBeVisible()

  await page.getByRole('button', { name: 'Contracts' }).click()
  await page.getByLabel('Client').selectOption({ label: clientName })
  await page.getByLabel('Contract name').fill(contractName)
  await page.getByLabel(siteName).check()
  await page.getByRole('button', { name: 'Activate contract' }).click()
  await expect(page.getByRole('status')).toContainText('Contract activated')
  await expect(page.getByText(contractName)).toBeVisible()
})
