import { expect, test, type Page } from '@playwright/test'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await page.goto('/schedule', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
  await expect(page.locator('[data-health-filter="conflicts"] .schedule-health-stat-main')).toBeVisible({ timeout: 15_000 })
}

test('attention overview deduplicates visits, preserves colours and sends undated services back to Clients', async ({ page }, testInfo) => {
  const worker = (id: string) => ({ id, name: id, email: `${id}@example.test`, role: 'employee' })
  const makeVisit = (id: string, start: number, employee: string, status = 'acknowledged', requiredWorkers = 1) => ({
    id, scheduledStart: `2026-09-02T${start}:00:00Z`, scheduledEnd: `2026-09-02T${start + 2}:00:00Z`,
    status: 'scheduled', version: 1, requiredWorkers, site: { name: id, city: 'Dublin', client: { displayName: id } },
    job: { name: 'Attention test' }, assignments: [{ status, user: worker(employee) }],
  })
  const visits = [makeVisit('Shared gap', 10, 'a', 'notified', 2), makeVisit('Overlap', 11, 'a'), makeVisit('Pending', 14, 'b', 'notified'), makeVisit('Healthy', 17, 'c')]
  const reply = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  await page.route('**/api/visits?**', (route) => route.fulfill(reply(visits)))
  await page.route('**/api/availability?**', (route) => route.fulfill(reply([])))
  await page.route('**/api/team', (route) => route.fulfill(reply(['a', 'b', 'c'].map(worker))))
  await page.route('**/api/service-plans', (route) => route.fulfill(reply([{
    id: 'plan-without-date', name: 'Undated service', status: 'published', expectedDurationMinutes: 120, requiredWorkers: 1,
    site: { id: 'site-undated', name: 'Undated site', city: 'Dublin', client: { id: 'client-undated', displayName: 'Undated service' } },
  }])))
  await page.route('**/api/schedule-health?**', (route) => route.fulfill(reply({ summary: { visits: 4, covered: 1, needsStaff: 1, unassigned: 0, missingSchedule: 0, unscheduledServices: 1, paused: 0, conflicts: 1, unacknowledged: 2 }, items: [
    { id: 'gap', visitId: 'Shared gap', state: 'needs_staff', clientName: 'Shared gap', detail: '1/2 assigned' },
    { id: 'conflict', visitId: 'Shared gap', state: 'cleaner_overlap', clientName: 'Shared gap', detail: 'Shared worker', conflict: { workerId: 'a', workerName: 'a', otherVisitId: 'Overlap', otherClientName: 'Overlap', otherSiteName: 'Overlap', otherScheduledStart: visits[1].scheduledStart, otherScheduledEnd: visits[1].scheduledEnd, overlapMinutes: 60 } },
    { id: 'unscheduled', state: 'unscheduled_service', servicePlanId: 'plan-without-date', clientId: 'client-undated', clientName: 'Undated service', detail: 'Schedule setup needed' },
  ] })))
  await page.goto('/schedule?date=2026-09-02&view=week')
  await expect(page.getByRole('button', { name: 'Needs attention', exact: true })).toHaveClass(/selected/)
  await expect(page.locator('.visit-card')).toHaveCount(3)
  await expect(page.getByText('3 visits need attention · each visit is counted once', { exact: true })).toBeVisible()
  const gap = page.locator('.visit-card').filter({ hasText: 'Shared gap' })
  await expect(gap).toHaveCount(1)
  await expect(gap).toContainText('Conflict')
  await expect(gap).toContainText('Team needed')
  await expect(gap).toContainText('Awaiting confirmation')
  const originalColour = await gap.evaluate((element) => getComputedStyle(element).backgroundColor)
  await expect(page.locator('[data-health-filter="conflicts"]')).toContainText('2 visits affected')
  for (const indicator of await page.locator('.schedule-health-stat-wrap').all()) {
    const bounds = await indicator.boundingBox()
    const action = await indicator.locator('.schedule-health-stat-details').boundingBox()
    expect(bounds).not.toBeNull()
    expect(action).not.toBeNull()
    expect(action!.x).toBeGreaterThanOrEqual(bounds!.x)
    expect(action!.x + action!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
  }
  const pending = page.getByRole('region', { name: 'Work not yet on calendar' })
  await expect(pending).toContainText('Undated service')
  await expect(pending).toContainText('No date set')
  await pending.getByRole('button', { name: 'Configure service' }).click()
  await expect(page).toHaveURL(/\/clients\/client-undated/)
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible()
  for (const [filter, count] of [['scheduling', 1], ['conflicts', 2], ['confirmation', 2]] as const) {
    await page.locator(`[data-health-filter="${filter}"] .schedule-health-stat-main`).click()
    await expect(page.locator('.visit-card')).toHaveCount(count)
    expect(await gap.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(originalColour)
    await page.locator('.schedule-health-active-filter').getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(page.locator('.visit-card')).toHaveCount(3)
  }
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click()
  await expect(page.locator('.visit-card')).toHaveCount(4)
  await expect(pending).toHaveCount(0)
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('attention-overview.png'), fullPage: true })
})

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('health cards filter the calendar without forcing the details drawer', async ({ page }) => {
  for (const [filter, label] of [
    ['scheduling', 'Needs scheduling'],
    ['conflicts', 'Conflicts'],
    ['confirmation', 'Awaiting confirmation'],
  ] as const) {
    const card = page.locator(`[data-health-filter="${filter}"]`)
    await card.locator('.schedule-health-stat-main').click()
    await expect(page.locator('.schedule-health-active-filter')).toContainText(label)
    await expect(page.getByRole('dialog', { name: new RegExp(`${label} details`, 'i') })).toHaveCount(0)
  }
})

test('staffing gaps keep their status colour when filtered', async ({ page }) => {
  const card = page.locator('[data-health-filter="scheduling"]')
  await card.locator('.schedule-health-stat-main').click()
  const firstVisit = page.locator('.visit-card').first()
  if (await firstVisit.count()) {
    const background = await firstVisit.evaluate((element) => getComputedStyle(element).backgroundColor)
    const tone = await firstVisit.getAttribute('data-attention')
    expect(background).toBe(tone === 'conflicts' ? 'rgb(255, 240, 241)' : 'rgb(255, 248, 234)')
  }
})

test('conflict count represents actionable overlap cases while all affected visits stay highlighted', async ({ page }) => {
  const card = page.locator('[data-health-filter="conflicts"]')
  const count = Number(await card.locator('.schedule-health-stat-main strong').innerText())

  await card.locator('.schedule-health-stat-main').click()
  await expect(page.locator('.schedule-health-active-filter')).toContainText('Conflicts')

  if (count > 0) {
    const visibleCards = page.locator('.visit-card')
    const conflictCards = page.locator('.visit-card.schedule-conflict')
    expect(await visibleCards.count()).toBeGreaterThan(0)
    expect(await conflictCards.count()).toBe(await visibleCards.count())

    await card.locator('.schedule-health-stat-details').click()
    const drawer = page.getByRole('dialog', { name: /Conflicts details/i })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText(/Double booked/i).first()).toBeVisible()
    await expect(drawer.locator('article')).toHaveCount(count)
    await drawer.getByRole('button', { name: 'Close' }).click()
    await expect(drawer).toBeHidden()
    await expect(page.locator('.schedule-health-active-filter')).toContainText('Conflicts')
  } else {
    await expect(card.locator('.schedule-health-stat-details')).toBeDisabled()
  }

  await page.locator('.schedule-health-active-filter').getByRole('button', { name: 'Clear' }).click()
  await expect(page.locator('.schedule-health-active-filter')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Needs attention', exact: true })).toHaveClass(/selected/)
})

test('week view always exposes Add visit on every day', async ({ page }) => {
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click()
  await page.getByRole('button', { name: 'Week', exact: true }).click()
  const columns = page.locator('.week-column')
  await expect(columns.first()).toBeVisible()
  expect(await columns.count()).toBe(7)
  expect(await page.getByRole('button', { name: '+ Add visit', exact: true }).count()).toBe(7)
})

test('capacity finder tolerates an empty date and waits for a valid date', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.getByRole('button', { name: 'Find a time', exact: true }).click()
  const finder = page.locator('.find-time')
  await expect(finder.getByRole('heading', { name: 'Find a workable time' })).toBeVisible()

  const dateInput = finder.locator('input[type="date"]')
  const originalDate = await dateInput.inputValue()
  expect(originalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await dateInput.fill('')
  await page.waitForTimeout(100)
  expect(pageErrors.some((message) => /Invalid date value/i.test(message))).toBe(false)
  await expect(finder.getByRole('heading', { name: 'Find a workable time' })).toBeVisible()
  await expect(dateInput).toHaveValue('')
  await expect(finder.getByText('Select a date to see workable times.')).toBeVisible()
  await expect(finder.locator('.find-time-slots button')).toHaveCount(0)

  await dateInput.fill('2027-09-25')
  await expect(dateInput).toHaveValue('2027-09-25')
  await expect(finder.locator('.find-time-slots button').first()).toBeVisible()
  expect(await finder.locator('.find-time-slots button').count()).toBeGreaterThanOrEqual(4)
  expect(pageErrors.some((message) => /Invalid date value/i.test(message))).toBe(false)
})

test('adding one visit refreshes schedule health without creating recurrence', async ({ page }) => {
  let healthRequests = 0
  let postedVisit: Record<string, unknown> | null = null
  const fakePlan = {
    id: 'extra-plan', name: 'Regular cleaning', status: 'published', expectedDurationMinutes: 150, requiredWorkers: 2,
    site: { id: 'extra-site', name: 'Ranelagh Clinic', city: 'Dublin', client: { id: 'extra-client', displayName: 'Merrion Dental' } },
  }
  await page.route('**/api/schedule-health?**', async (route) => {
    healthRequests += 1
    await route.continue()
  })
  await page.route('**/api/service-plans', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: [fakePlan] }) }))
  await page.route('**/api/visits', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    postedVisit = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: 'manual-extra' } }) })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-health-filter="scheduling"] .schedule-health-stat-main')).toBeVisible()
  const beforeCreate = healthRequests

  await page.getByRole('button', { name: '+ Add visit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add visit' })
  await expect(dialog).toContainText('recurring service')
  await expect(dialog.getByText('Merrion Dental · Ranelagh Clinic')).toBeVisible()
  await expect(dialog.getByLabel('People required')).toHaveValue('2')
  await dialog.getByRole('button', { name: 'Add visit', exact: true }).click()

  await expect(page.getByText('Visit added to Schedule. The client service pattern was not changed.')).toBeVisible()
  await expect.poll(() => healthRequests).toBeGreaterThan(beforeCreate)
  expect(postedVisit).toMatchObject({ servicePlanId: 'extra-plan', durationMinutes: 150, requiredWorkers: 2, reason: 'extra_cleaning' })
  await expect(dialog).toHaveCount(0)
})

test('Escape closes only the topmost filter surface and never reopens it', async ({ page }) => {
  await page.getByRole('button', { name: /^Filters/ }).click()
  const filters = page.getByRole('dialog', { name: 'Schedule filters' })
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: /All team/ }).click()

  await page.keyboard.press('Escape')
  await expect(filters).toHaveCount(0)
  await page.waitForTimeout(150)
  await expect(filters).toHaveCount(0)
})

test('schedule and health drawer stay within the viewport', async ({ page }) => {
  const scheduling = page.locator('[data-health-filter="scheduling"]')
  const count = Number(await scheduling.locator('.schedule-health-stat-main strong').innerText())
  if (count > 0) {
    await scheduling.locator('.schedule-health-stat-details').click()
    const drawer = page.getByRole('dialog', { name: /Needs scheduling details/i })
    await expect(drawer).toBeVisible()
    const box = await drawer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('rejected occurrence save stays failed and stale error clears when the current team changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click()
  await page.getByRole('button', { name: 'Week', exact: true }).click()

  const firstVisit = page.locator('.visit-card').first()
  await expect(firstVisit).toBeVisible()
  await firstVisit.click()

  const editor = page.locator('.schedule-edit-sheet')
  await expect(editor).toBeVisible()

  let patchCount = 0
  await editor.getByLabel('Dispatch note').fill('Keep this draft after a rejected save')
  await page.route('**/api/visits/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue()
    patchCount += 1
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        code: 'ASSIGNEE_WORKFORCE_CONSTRAINT',
        error: 'Aisha Khan is in school during this visit. Choose another cleaner or change the time.',
      }),
    })
  })

  await editor.getByRole('button', { name: 'Save occurrence', exact: true }).click()
  await expect(editor.locator('.schedule-edit-error')).toContainText('Aisha Khan is in school during this visit')
  expect(patchCount).toBe(1)
  await expect(editor.getByLabel('Dispatch note')).toHaveValue('Keep this draft after a rejected save')
  await expect(page.getByText('Visit updated and the assigned team has been notified.', { exact: true })).toHaveCount(0)

  await editor.getByRole('button', { name: /(?:Select|Change) team/ }).click()
  const picker = page.getByRole('dialog', { name: 'Assigned cleaning team' })
  const firstCheckbox = picker.getByRole('checkbox').first()
  await firstCheckbox.click()
  await picker.getByRole('button', { name: 'Apply' }).click()

  await expect(editor.locator('.schedule-edit-error')).toHaveCount(0)
})

test('employee scope follows A to B to all and browser history, including health and capacity', async ({ page }, testInfo) => {
  const members = [
    { id: 'audit-a', name: 'Audit Alpha', email: 'alpha@example.test', role: 'employee' },
    { id: 'audit-b', name: 'Audit Beta', email: 'beta@example.test', role: 'employee' },
  ]
  const visits = members.map((member, index) => ({
    id: `audit-visit-${index}`, scheduledStart: '2026-09-02T09:00:00Z', scheduledEnd: '2026-09-02T11:00:00Z',
    status: 'scheduled', version: 1, requiredWorkers: 2, site: { name: member.name, city: 'Dublin', client: { displayName: member.name } },
    job: { name: 'Audit work' }, assignments: [{ status: 'acknowledged', user: member }],
  }))
  const reply = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) })
  await page.route('**/api/team', (route) => route.fulfill(reply(members)))
  await page.route('**/api/visits?**', (route) => route.fulfill(reply(visits)))
  await page.route('**/api/availability?**', (route) => route.fulfill(reply([])))
  let lastScope: string | null = null
  await page.route('**/api/schedule-health?**', async (route) => {
    const query = new URL(route.request().url()).searchParams
    lastScope = query.get('employeeId')
    const scoped = lastScope ? visits.filter((visit) => visit.assignments[0].user.id === lastScope) : visits
    await route.fulfill(reply({ from: query.get('from'), to: query.get('to'), summary: {
      visits: scoped.length, covered: 0, needsStaff: scoped.length, unassigned: 0, missingSchedule: 0,
      unscheduledServices: 0, paused: 0, conflicts: 0, unacknowledged: 0,
    }, items: scoped.map((visit) => ({ id: visit.id, visitId: visit.id, state: 'needs_staff', clientName: visit.site.client.displayName,
      detail: '1/2 assigned', scheduledStart: visit.scheduledStart, scheduledEnd: visit.scheduledEnd })) }))
  })
  await page.goto('/schedule?employee=audit-a&date=2026-09-02&view=week')
  await expect(page.locator('.visit-card')).toHaveCount(1)
  await expect(page.locator('.visit-card')).toContainText('Audit Alpha')
  await expect.poll(() => lastScope).toBe('audit-a')
  await expect(page.getByRole('button', { name: 'Needs attention', exact: true })).toBeVisible()

  let capacityIds: string[] = []
  await page.route('**/api/schedule-capacity', async (route) => {
    capacityIds = route.request().postDataJSON().userIds
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Availability service unavailable. Try again.' }) })
  })
  await page.getByRole('button', { name: 'Find a time', exact: true }).click()
  await expect.poll(() => capacityIds).toEqual(['audit-a'])
  await expect(page.locator('.find-time').getByRole('alert')).toContainText('Availability service unavailable')
  await expect(page.locator('.find-time input[type="date"]')).toHaveValue('2026-09-02')
  await page.locator('.find-time').getByRole('button', { name: 'Close', exact: true }).click()

  for (const [label, expectedScope, count] of [['Audit Beta', 'audit-b', 1], ['All team', null, 2]] as const) {
    await page.getByRole('button', { name: /^Filters/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Schedule filters' })
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(() => lastScope).toBe(expectedScope)
    await expect(page.locator('.visit-card')).toHaveCount(count)
    await expect(page.locator('[data-health-filter="scheduling"] strong')).toHaveText(String(count))
  }
  await page.goBack()
  await expect(page).toHaveURL(/employee=audit-b/)
  await expect.poll(() => lastScope).toBe('audit-b')
  await expect(page.locator('.visit-card')).toHaveCount(1)
  await expect(page.locator('.visit-card')).toContainText('Audit Beta')
  await page.locator('[data-health-filter="scheduling"] .schedule-health-stat-details').click()
  const drawer = page.getByRole('dialog', { name: /Needs scheduling details/i })
  await expect(drawer.locator('article')).toHaveCount(1)
  await expect(drawer).toContainText('Audit Beta')
  await page.screenshot({ path: testInfo.outputPath('employee-scope.png') })
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click()
  await expect(page.locator('.schedule-health-active-filter')).toHaveCount(0)
})
