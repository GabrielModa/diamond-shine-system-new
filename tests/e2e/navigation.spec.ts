import { expect, test, type Page } from '@playwright/test'

async function login(page: Page, email: string) {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
}

const protectedRoutes = [
  '/home',
  '/schedule',
  '/people',
  '/live-operations',
  '/field-control',
  '/supplies',
  '/timesheets',
  '/insights',
  '/team-performance',
  '/quality',
  '/feedback',
  '/dashboard',
  '/clients',
  '/users',
  '/audit',
  '/communications',
  '/my-requests',
  '/profile',
  '/operations',
  '/work-orders',
] as const

test('organization admin can reach every protected product module without a dead route, runtime crash or horizontal page overflow', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await login(page, 'admin@ds.ie')

  for (const route of protectedRoutes) {
    pageErrors.length = 0
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), `${route} should return a successful document`).toBeLessThan(400)
    await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`))
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.getByText('This page could not be found.', { exact: true })).toHaveCount(0)
    await page.waitForTimeout(100)
    expect(pageErrors, `${route} emitted an uncaught browser error`).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${route} should not force document-level horizontal scrolling`).toBeLessThanOrEqual(1)
  }
})

test('desktop navigation exposes every normal module and keeps only advanced registries out of the menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop dropdown structure is covered once; mobile routes are covered by the route smoke test.')
  await login(page, 'admin@ds.ie')

  const expectedBySection = new Map<string, string[]>([
    ['Run operations', ['Command centre', 'Schedule', 'Plan coverage', 'Live workforce', 'Field control', 'Supplies', 'Timesheets']],
    ['Quality & insights', ['Operations intelligence', 'Team performance', 'Quality control', 'Service feedback', 'Management dashboard']],
    ['Manage business', ['Clients', 'People & access', 'Audit trail']],
    ['My workspace', ['Inbox', 'My requests', 'My profile']],
  ])

  for (const [section, labels] of expectedBySection) {
    await page.getByRole('button', { name: new RegExp(`^${section}`) }).click()
    const panel = page.locator('.nav-workspace-panel:visible')
    await expect(panel).toBeVisible()
    for (const label of labels) await expect(panel.getByRole('link', { name: label, exact: true })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Work orders', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('link', { name: 'Service setup', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: new RegExp(`^${section}`) }).click()
  }
})

test('employee cannot reach manager-only quality or business administration modules', async ({ page }) => {
  await login(page, 'employee@ds.ie')

  for (const route of ['/feedback', '/dashboard', '/clients', '/users', '/audit'] as const) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/forbidden$/)
  }
})
