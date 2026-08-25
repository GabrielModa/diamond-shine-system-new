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
})

afterAll(async () => {
  await prisma.$disconnect()
})
