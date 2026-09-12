import { expect, test, type Page } from '@playwright/test'
import { loginAsAdmin, uniqueLabel } from './helpers/operational-scenario'

function dateInput(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function localDateTime(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60_000)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

async function mockVerifiedAddress(page: Page) {
  await page.route('**/api/places/autocomplete', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: [{
          placeId: 'client-lifecycle-place',
          text: '1 Lifecycle Street, Dublin 2, D02 LIFE',
          mainText: '1 Lifecycle Street',
          secondaryText: 'Dublin 2, D02 LIFE',
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
          placeId: 'client-lifecycle-place',
          displayName: '1 Lifecycle Street',
          formattedAddress: '1 Lifecycle Street, Dublin 2, D02 LIFE',
          latitude: 53.3451,
          longitude: -6.2811,
          types: ['street_address'],
          addressLine1: '1 Lifecycle Street',
          city: 'Dublin 2',
          region: 'Co. Dublin',
          postalCode: 'D02 LIFE',
          countryCode: 'IE',
        },
      }),
    })
  })
}

test('client account persists through create, service, pause, resume, end and archive', async ({ page }) => {
  await loginAsAdmin(page)
  await mockVerifiedAddress(page)
  const name = uniqueLabel('Lifecycle client')

  await page.goto('/clients')
  await page.getByRole('button', { name: 'New client', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'New client' })
  await create.getByLabel('Client name').fill(name)
  await create.getByLabel('Primary contact name').fill('Lifecycle Contact')
  await create.getByLabel('Primary contact email').fill('lifecycle@example.ie')

  const address = create.getByRole('combobox', { name: 'Service address' })
  await address.fill('1 Lifecycle')
  await page.getByRole('option', { name: /1 Lifecycle Street/ }).click()
  await create.getByRole('button', { name: 'Create client & continue to service setup' }).click()

  await page.waitForURL(/\/clients\/[^/?]+\?setup=1/)
  const accountPath = new URL(page.url()).pathname
  const setup = page.getByRole('dialog', { name: 'Set up cleaning service' })
  await expect(setup).toBeVisible()

  // Prove the atomic Client + first Location survives a fresh read before creating Service.
  await setup.getByRole('button', { name: 'Cancel' }).click()
  await page.goto(accountPath)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('1 Lifecycle Street', { exact: false }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText('setup needed', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Set up service', exact: true }).click()
  await expect(setup).toBeVisible()
  await setup.getByLabel('Service starts').fill(dateInput(7))
  await setup.getByLabel('Contract ends').fill(dateInput(45))
  await setup.getByLabel('Preferred time').fill('09:00')
  await setup.getByRole('button', { name: 'Activate service', exact: true }).click()
  await expect(setup).toBeHidden()
  await expect(page.getByRole('status')).toContainText('Service activated')
  await page.reload()

  const serviceCard = page.locator('.client-service-card').filter({ hasText: 'Regular cleaning' }).first()
  await expect(serviceCard).toContainText('in service')
  await expect(serviceCard.getByRole('button', { name: 'Pause service', exact: true })).toBeVisible()

  await serviceCard.getByRole('button', { name: 'Pause service', exact: true }).click()
  const pause = page.getByRole('dialog', { name: 'Pause service' })
  await pause.getByLabel('From').fill(dateInput())
  await pause.getByLabel('Until').fill(dateInput(14))
  await pause.getByLabel('Reason').fill('Client office closed')
  await pause.getByLabel('Note').fill('Temporary closure for refurbishment.')
  await pause.getByRole('button', { name: 'Preview impact', exact: true }).click()
  await expect(pause.getByRole('status')).toContainText('generated visits')
  await pause.getByRole('button', { name: 'Confirm pause', exact: true }).click()
  await expect(pause).toBeHidden()
  await expect(serviceCard).toContainText('paused')
  await page.reload()
  await expect(serviceCard.getByRole('button', { name: 'Resume service', exact: true })).toBeVisible()

  await serviceCard.getByRole('button', { name: 'Resume service', exact: true }).click()
  await expect(serviceCard).toContainText('Historical cancellations remain')
  await page.reload()
  await expect(serviceCard).toContainText('in service')

  // Active recurring work must make Archive fail without a false success state.
  await page.getByRole('button', { name: 'Archive client', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Archive client' })
  await archive.getByRole('button', { name: 'Confirm archive client', exact: true }).click()
  await expect(archive.getByRole('alert')).toContainText('End all active services')
  await expect(page).toHaveURL(new RegExp(accountPath))
  await archive.getByRole('button', { name: 'Cancel', exact: true }).click()

  await serviceCard.getByRole('button', { name: 'End service', exact: true }).click()
  const end = page.getByRole('dialog', { name: 'End service' })
  await end.getByLabel('Effective from').fill(localDateTime(-1))
  await end.getByLabel('Reason').fill('Client contract finished')
  await end.getByRole('button', { name: 'Preview impact', exact: true }).click()
  await expect(end.getByRole('status')).toContainText('manual extra visits preserved')
  await end.getByRole('button', { name: 'Confirm end service', exact: true }).click()
  await expect(end).toBeHidden()
  await expect(serviceCard).toContainText('ended')
  await page.reload()
  await expect(serviceCard.getByRole('button', { name: 'End service', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Archive client', exact: true }).click()
  await page.getByRole('dialog', { name: 'Archive client' }).getByRole('button', { name: 'Confirm archive client', exact: true }).click()
  await page.waitForURL(/\/clients\?lifecycle=archived/)
  await expect(page.getByText(name, { exact: true })).toBeVisible()

  await page.getByText(name, { exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Archived client')
  await expect(page.getByRole('button', { name: 'Edit profile' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add location' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Set up service' })).toHaveCount(0)
  await expect(page.getByText('Recent service history')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('status')).toContainText('read only')
})
