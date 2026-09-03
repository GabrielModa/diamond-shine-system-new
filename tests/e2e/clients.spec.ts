import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('new client stays in one stable dialog and refuses an unverified service address', async ({ page }) => {
  await page.goto('/clients', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'New client', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'New client' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Client', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Service location', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/STEP 1 OF 2/i)).toHaveCount(0)
  await expect(dialog.getByText(/STEP 2 OF 2/i)).toHaveCount(0)
  await expect(dialog.getByText(/Usually Home/i)).toHaveCount(0)

  const clientName = dialog.getByLabel('Client name')
  await clientName.pressSequentially('Stable client typing', { delay: 10 })
  await expect(clientName).toHaveValue('Stable client typing')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Create client & continue to service setup' }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Select the service address from the Google Maps suggestions' }).first(),
  ).toContainText('Select the service address from the Google Maps suggestions')
  await expect(dialog).toBeVisible()
})

test('Google Maps selection is the source of truth for client city, postcode and verified coordinates', async ({ page }) => {
  await page.route('**/api/places/autocomplete', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: [{
          placeId: 'client-e2e-place',
          text: "Usher's Quay, Dublin 8, Co. Dublin, D08 HV21",
          mainText: "Usher's Quay",
          secondaryText: 'Dublin 8, D08 HV21',
          types: ['street_address'],
        }],
      }),
    })
  })
  await page.route('**/api/places/resolve', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          placeId: 'client-e2e-place',
          displayName: "Usher's Quay",
          formattedAddress: "Usher's Quay, Dublin 8, Co. Dublin, D08 HV21",
          latitude: 53.3451,
          longitude: -6.2811,
          types: ['street_address'],
          addressLine1: "Usher's Quay",
          city: 'Dublin 8',
          region: 'Co. Dublin',
          postalCode: 'D08 HV21',
          countryCode: 'IE',
        },
      }),
    })
  })

  await page.goto('/clients', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'New client', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New client' })

  const address = dialog.getByRole('combobox', { name: 'Service address' })
  await address.fill("Usher's")
  const option = page.getByRole('option', { name: /Usher's Quay/ })
  await expect(option).toBeVisible()
  await option.click()

  await expect(address).toHaveValue("Usher's Quay, Dublin 8, Co. Dublin, D08 HV21")
  await expect(dialog.getByText('Verified with Google Maps')).toBeVisible()
  await expect(dialog.getByLabel('City')).toHaveValue('Dublin 8')
  await expect(dialog.getByLabel('Eircode / postcode')).toHaveValue('D08 HV21')
  await expect(dialog.getByLabel('City')).toHaveAttribute('readonly', '')
  await expect(dialog.getByLabel('Eircode / postcode')).toHaveAttribute('readonly', '')
})
