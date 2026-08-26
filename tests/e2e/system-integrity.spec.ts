import { expect, test } from '@playwright/test'
import { prisma } from '../../src/lib/prisma'

const prefix = 'E2E integrity cancellation'

async function cleanup() {
  const jobs = await prisma.job.findMany({ where: { name: { startsWith: prefix } }, select: { id: true } })
  const jobIds = jobs.map((job) => job.id)
  if (!jobIds.length) return
  const visits = await prisma.visit.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } })
  const visitIds = visits.map((visit) => visit.id)
  if (visitIds.length) {
    const notices = await prisma.operationalNotice.findMany({ where: { visitId: { in: visitIds } }, select: { id: true } })
    const noticeIds = notices.map((notice) => notice.id)
    if (noticeIds.length) await prisma.notificationJob.deleteMany({ where: { entityType: 'operational_notice', entityId: { in: noticeIds } } })
    await prisma.operationalNoticeRecipient.deleteMany({ where: { noticeId: { in: noticeIds } } })
    await prisma.operationalNotice.deleteMany({ where: { id: { in: noticeIds } } })
    await prisma.visitAssignment.deleteMany({ where: { visitId: { in: visitIds } } })
    await prisma.visit.deleteMany({ where: { id: { in: visitIds } } })
  }
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } })
}

test.beforeEach(async ({ page }) => {
  await cleanup()
  await page.goto('/login')
  await page.fill('input[type="email"]', 'admin@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
})

test.afterEach(async () => { await cleanup() })
test.afterAll(async () => { await prisma.$disconnect() })

test('schedule exposes one create-work dialog', async ({ page }) => {
  await page.goto('/schedule')
  await page.getByRole('button', { name: '+ Create work', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Schedule cleaning work' })).toBeVisible()
})

test('employee receives a role-specific home instead of manager command centre', async ({ page }) => {
  await page.request.post('/api/auth/logout')
  await page.goto('/login')
  await page.fill('input[type="email"]', 'employee@ds.ie')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/home/)
  await expect(page.getByRole('heading', { name: 'What needs your attention' })).toBeVisible()
  await expect(page.getByText('Operations command centre')).toHaveCount(0)
})

test('cancelled visit leaves Operational schedule and remains in History with its reason', async ({ page }) => {
  const name = `${prefix} ${Date.now()}`
  const planId = await page.evaluate(async () => {
    const response = await fetch('/api/service-plans', { credentials: 'include', cache: 'no-store' })
    const body = await response.json()
    return body.data.find((plan: { status: string }) => plan.status === 'published')?.id as string | undefined
  })
  expect(planId).toBeTruthy()

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
  start.setHours(10, 0, 0, 0)
  const created = await page.evaluate(async ({ planId, name, startAt }) => {
    const response = await fetch('/api/jobs', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ servicePlanId: planId, name, startAt, timezone: 'Europe/Dublin', recurrence: { frequency: 'once' }, assigneeIds: [] }),
    })
    return { status: response.status, body: await response.json() }
  }, { planId: planId!, name, startAt: start.toISOString() })
  expect(created.status).toBe(201)

  await page.goto('/schedule')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByText(name, { exact: false })).toBeVisible()
  await page.getByText(name, { exact: false }).first().click()
  await page.getByLabel('Cancellation reason').fill('Client requested closure for access works')
  await page.getByRole('button', { name: 'Cancel visit', exact: true }).click()

  await expect(page.getByText(name, { exact: false })).toHaveCount(0)
  await page.getByLabel('Status').selectOption('history')
  await expect(page.getByText(name, { exact: false })).toBeVisible()
  await page.getByText(name, { exact: false }).first().click()
  await expect(page.getByLabel('Cancellation reason')).toHaveValue('Client requested closure for access works')
})
