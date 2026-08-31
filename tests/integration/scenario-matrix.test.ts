import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/lib/prisma'
import { seedUsers } from './setup'
import { seedScenarioMatrix } from '../../prisma/seed-scenario-matrix'
import { DEMO_EMPLOYEE_SCENARIOS, DEMO_SITE_SCENARIOS } from '../../src/lib/demo-scenarios'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'

beforeAll(async () => {
  await seedUsers()
  await seedScenarioMatrix()
}, 120_000)

describe('scenario matrix seed', () => {
  it('preserves a broad employee matrix instead of replacing demo users', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: DEMO_EMPLOYEE_SCENARIOS.map((item) => item.email) } },
      select: { email: true, workforceProfile: true },
    })
    expect(users).toHaveLength(DEMO_EMPLOYEE_SCENARIOS.length)
    expect(users.every((user) => Boolean(user.workforceProfile))).toBe(true)
  })

  it('creates additional companies, sites, jobs and visits for schedule coverage', async () => {
    const clients = await prisma.client.findMany({
      where: {
        organizationId: LEGACY_ORGANIZATION_ID,
        externalId: { in: DEMO_SITE_SCENARIOS.map((item) => item.externalId) },
      },
      select: { id: true, sites: { select: { id: true, jobs: { select: { id: true, visits: { select: { id: true } } } } } } },
    })
    expect(clients).toHaveLength(DEMO_SITE_SCENARIOS.length)
    expect(clients.every((client) => client.sites.length >= 1)).toBe(true)
    expect(clients.every((client) => client.sites.some((site) => site.jobs.some((job) => job.visits.length >= 5)))).toBe(true)
  })

  it('creates morning, daytime and evening schedule examples', async () => {
    const visits = await prisma.visit.findMany({
      where: {
        organizationId: LEGACY_ORGANIZATION_ID,
        job: { name: { startsWith: 'Scenario · ' } },
      },
      select: { scheduledStart: true },
    })
    const hours = visits.map((visit) => visit.scheduledStart.getHours())
    expect(hours.some((hour) => hour < 8)).toBe(true)
    expect(hours.some((hour) => hour >= 9 && hour < 17)).toBe(true)
    expect(hours.some((hour) => hour >= 18)).toBe(true)
  })

  it('creates ten recurring and temporary availability examples without replacing manual data', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: DEMO_EMPLOYEE_SCENARIOS.slice(0, 10).map((item) => item.email) } },
      select: { id: true, workforceProfile: { select: { recurringUnavailability: { where: { reason: { startsWith: 'Scenario matrix:' } } } } } },
    })
    const temporary = await prisma.availability.count({
      where: { organizationId: LEGACY_ORGANIZATION_ID, userId: { in: users.map((user) => user.id) }, reason: { startsWith: 'Scenario matrix:' } },
    })
    expect(users.reduce((total, user) => total + (user.workforceProfile?.recurringUnavailability.length ?? 0), 0)).toBe(10)
    expect(temporary).toBe(10)
  })

  it('keeps future needs-staff visits unassigned while preserving covered examples', async () => {
    const futureVisits = await prisma.visit.findMany({
      where: { organizationId: LEGACY_ORGANIZATION_ID, scheduledStart: { gte: new Date() }, job: { name: { startsWith: 'Scenario · ' } } },
      select: { job: { select: { instructions: true } }, assignments: true },
    })
    expect(futureVisits.some((visit) => visit.job.instructions?.includes('needs-staff') && visit.assignments.length === 0)).toBe(true)
    expect(futureVisits.some((visit) => !visit.job.instructions?.includes('needs-staff') && visit.assignments.length > 0)).toBe(true)
  })

  it('seeds deterministic quality bands including excellent, good, watch, issues and no-feedback cases', async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: ['aisha@ds.ie', 'aoife@ds.ie', 'liam@ds.ie', 'omar@ds.ie', 'daniel@ds.ie'] } },
      select: { id: true, email: true },
    })
    const byEmail = new Map(users.map((user) => [user.email, user.id]))
    const feedback = await prisma.feedbackEntry.findMany({
      where: { organizationId: LEGACY_ORGANIZATION_ID, employeeId: { in: users.map((user) => user.id) }, comments: { startsWith: 'Scenario matrix v10:' } },
      select: { employeeId: true, overall: true },
    })
    const average = (email: string) => {
      const rows = feedback.filter((item) => item.employeeId === byEmail.get(email))
      return rows.length ? rows.reduce((sum, item) => sum + item.overall, 0) / rows.length : null
    }
    expect(average('aisha@ds.ie')).toBeGreaterThanOrEqual(4.5)
    expect(average('aoife@ds.ie')).toBeGreaterThanOrEqual(4)
    expect(average('liam@ds.ie')).toBeGreaterThanOrEqual(3.5)
    expect(average('omar@ds.ie')).toBeLessThan(3.5)
    expect(average('daniel@ds.ie')).toBeNull()
  })

})

afterAll(async () => {
  await prisma.$disconnect()
})
