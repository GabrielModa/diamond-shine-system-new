import { expect, test } from '@playwright/test'
import { api, createOperationalClient, loginAsAdmin, loginAsEmployee, uniqueLabel } from './helpers/operational-scenario'

test('repeat request restores the original context and own cancellation persists', async ({ browser }) => {
  const baseURL = test.info().project.use.baseURL as string

  // Build only the unique Client/Site prerequisite through real product APIs.
  const adminContext = await browser.newContext({ baseURL })
  const adminPage = await adminContext.newPage()
  await loginAsAdmin(adminPage)
  const location = uniqueLabel('Requests acceptance site')
  const client = await createOperationalClient(adminPage, location)
  await adminContext.close()

  const employeeContext = await browser.newContext({ baseURL })
  try {
    const page = await employeeContext.newPage()
    await loginAsEmployee(page)

    const bootstrap = await api<{
      sites: Array<{ id: string; name: string }>
      catalog: Array<{ id: string; name: string }>
    }>(page, '/api/supplies/bootstrap')
    const site = bootstrap.sites.find((item) => item.id === client.sites[0].id)
    expect(site, 'The unique Client site must be available to the employee supplies flow.').toBeTruthy()
    const material = bootstrap.catalog[0]
    expect(material, 'The supplies catalog must contain at least one requestable material.').toBeTruthy()
    if (!site || !material) return

    const note = uniqueLabel('Repeat request note')
    await api(page, '/api/supplies', {
      siteId: site.id,
      priority: 'low',
      notes: note,
      items: [{ catalogItemId: material.id, quantity: 3 }],
    })

    await page.goto('/my-requests')
    let card = page.locator('.request-history-card').filter({ hasText: location })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(`${material.name} × 3`)
    await expect(card).toContainText('Requested')

    await card.getByRole('button', { name: 'Repeat request', exact: true }).click()
    await page.waitForURL(/\/supplies$/)

    // Repeat must restore the previous request into the actual form, not merely navigate.
    await expect(page.getByRole('heading', { name: 'Manual material request' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Client site' })).toContainText(location)
    await expect(page.locator(`input[data-catalog-id="${material.id}"]`)).toHaveValue('3')
    await expect(page.getByRole('button', { name: 'Low', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Reason / delivery note', { exact: true })).toHaveValue(note)

    // Repeating is a draft action; it must not create a second request until submitted.
    await page.goto('/my-requests')
    card = page.locator('.request-history-card').filter({ hasText: location })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Requested')

    page.once('dialog', (dialog) => dialog.accept())
    await card.getByRole('button', { name: 'Cancel request', exact: true }).click()
    await expect(card).toContainText('Cancelled')
    await expect(card.getByRole('button', { name: 'Cancel request', exact: true })).toHaveCount(0)

    await page.reload()
    card = page.locator('.request-history-card').filter({ hasText: location })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Cancelled')
    await expect(card.getByRole('button', { name: 'Cancel request', exact: true })).toHaveCount(0)
  } finally {
    await employeeContext.close()
  }
})
