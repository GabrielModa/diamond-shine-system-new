import { PrismaClient } from '@prisma/client'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'
import { operationalDateKey } from '../src/lib/operational-time'
import { workforceConstraintForWindow } from '../src/modules/scheduling/workforce-constraints'

const prisma = new PrismaClient()
const TZ = 'Europe/Dublin'
const ACTIVE = ['assigned', 'notified', 'seen', 'acknowledged'] as const
const OPERATIONAL_LAB_DAYS = 16

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Demo operational check failed: ${message}`)
}

async function siteByExternalId(externalId: string) {
  const client = await prisma.client.findUnique({
    where: { organizationId_externalId: { organizationId: LEGACY_ORGANIZATION_ID, externalId } },
  })
  assert(client, `missing client ${externalId}`)
  const site = await prisma.site.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id } })
  assert(site, `missing site for ${externalId}`)
  return site
}

async function firstUpcoming(externalId: string) {
  const site = await siteByExternalId(externalId)
  const visit = await prisma.visit.findFirst({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      siteId: site.id,
      scheduledStart: { gte: new Date() },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
      job: { name: { startsWith: 'Scenario ·' } },
    },
    include: { assignments: true },
    orderBy: { scheduledStart: 'asc' },
  })
  assert(visit, `missing upcoming scenario visit for ${externalId}`)
  return visit
}

async function main() {
  const now = new Date()
  const horizon = new Date(now.getTime() + OPERATIONAL_LAB_DAYS * 24 * 60 * 60_000)
  const employees = await prisma.user.findMany({
    where: {
      status: 'active',
      memberships: { some: { organizationId: LEGACY_ORGANIZATION_ID, status: 'active', role: { in: ['employee', 'field_supervisor'] } } },
    },
    include: {
      workforceProfile: {
        include: { studySchedules: true, recurringUnavailability: true, leaves: true },
      },
    },
  })
  assert(employees.length >= 15, `expected at least 15 operational people, found ${employees.length}`)
  const configured = employees.filter((employee) => employee.workforceProfile?.weeklyTargetConfigured)
  assert(configured.length >= 15, `expected at least 15 configured workforce profiles, found ${configured.length}`)
  const homeMapped = configured.filter((employee) => employee.workforceProfile?.homeLatitude != null && employee.workforceProfile.homeLongitude != null)
  assert(homeMapped.length >= 15, `expected at least 15 home map origins, found ${homeMapped.length}`)
  const contactReady = configured.filter((employee) =>
    employee.workforceProfile?.phone &&
    employee.workforceProfile.emergencyContactName &&
    employee.workforceProfile.emergencyContactPhone)
  assert(contactReady.length >= 15, `expected at least 15 profiles with phone/emergency data, found ${contactReady.length}`)

  const sites = await prisma.site.findMany({
    where: { organizationId: LEGACY_ORGANIZATION_ID, status: 'active', latitude: { not: null }, longitude: { not: null } },
  })
  assert(sites.length >= 10, `expected at least 10 geocoded service sites, found ${sites.length}`)

  const aisha = employees.find((employee) => employee.email === 'aisha@ds.ie')
  assert(aisha?.workforceProfile?.schoolLatitude != null, 'Aisha must have a mapped school origin')
  assert(aisha.workforceProfile.studySchedules.some((rule) => rule.startsMinute === 0 && rule.endsMinute === 1440), 'Aisha must keep the all-day school test schedule')

  const activePersonalLeave = configured.filter((employee) => employee.workforceProfile?.leaves.some((leave) => leave.kind === 'personal_leave' && leave.startsAt <= now && leave.endsAt > now))
  assert(activePersonalLeave.length >= 2, `expected at least two active personal-leave scenarios, found ${activePersonalLeave.length}`)

  const liffey = await firstUpcoming('scenario-liffey-tech')
  const liffeyActive = liffey.assignments.filter((assignment) => ACTIVE.includes(assignment.status as typeof ACTIVE[number])).length
  assert(liffey.requiredWorkers === 2 && liffeyActive === 0, `Liffey must be 0/2, found ${liffeyActive}/${liffey.requiredWorkers}`)

  const greenpark = await firstUpcoming('scenario-greenpark-care')
  const greenparkActive = greenpark.assignments.filter((assignment) => ACTIVE.includes(assignment.status as typeof ACTIVE[number])).length
  assert(greenpark.requiredWorkers === 2 && greenparkActive === 1, `Greenpark must be 1/2, found ${greenparkActive}/${greenpark.requiredWorkers}`)

  const merrion = await firstUpcoming('scenario-merrion-dental')
  const merrionStatuses = merrion.assignments.map((assignment) => assignment.status)
  assert(merrionStatuses.includes('acknowledged') && merrionStatuses.some((status) => status !== 'acknowledged'), 'Merrion must contain acknowledged + pending assignments')

  const pendingAssignments = await prisma.visitAssignment.count({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      status: { in: ['assigned', 'notified', 'seen'] },
      visit: {
        scheduledStart: { gte: now, lt: horizon },
        status: { notIn: ['cancelled', 'completed', 'missed'] },
        job: { name: { startsWith: 'Scenario ·' } },
      },
    },
  })
  assert(pendingAssignments === 1, `expected exactly one future acknowledgement pending assignment, found ${pendingAssignments}`)

  const futureAssignments = await prisma.visitAssignment.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      status: { in: [...ACTIVE] },
      visit: {
        scheduledStart: { gte: now, lt: horizon },
        status: { notIn: ['cancelled', 'completed', 'missed'] },
        job: { name: { startsWith: 'Scenario ·' } },
      },
    },
    include: {
      user: {
        include: {
          workforceProfile: { include: { studySchedules: true, recurringUnavailability: true, leaves: true } },
        },
      },
      visit: { select: { id: true, scheduledStart: true, scheduledEnd: true, timezone: true, site: { select: { name: true } } } },
    },
    orderBy: { visit: { scheduledStart: 'asc' } },
  })
  const futureAvailability = await prisma.availability.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      cancelledAt: null,
      startsAt: { lt: horizon },
      endsAt: { gt: now },
    },
  })
  for (const assignment of futureAssignments) {
    const profile = assignment.user.workforceProfile
    assert(profile?.weeklyTargetConfigured, `${assignment.user.email} is assigned without configured workforce setup`)
    const workforceBlock = workforceConstraintForWindow({
      studySchedules: profile.studySchedules,
      recurringUnavailability: profile.recurringUnavailability,
      leaves: profile.leaves.map((leave) => ({
        kind: leave.kind as 'school_holiday' | 'personal_leave',
        startsAt: leave.startsAt,
        endsAt: leave.endsAt,
        reason: leave.reason,
      })),
    }, assignment.visit.scheduledStart, assignment.visit.scheduledEnd, TZ)
    assert(!workforceBlock, `${assignment.user.email} is assigned while blocked by ${workforceBlock?.kind ?? 'workforce rule'} at ${assignment.visit.site.name}`)
    const temporaryBlock = futureAvailability.find((entry) =>
      entry.userId === assignment.userId &&
      entry.startsAt < assignment.visit.scheduledEnd &&
      entry.endsAt > assignment.visit.scheduledStart)
    assert(!temporaryBlock, `${assignment.user.email} is assigned during temporary unavailability at ${assignment.visit.site.name}`)
  }

  const byUser = new Map<string, typeof futureAssignments>()
  for (const assignment of futureAssignments) {
    const list = byUser.get(assignment.userId) ?? []
    list.push(assignment)
    byUser.set(assignment.userId, list)
  }
  const conflictPairs = new Map<string, string>()
  for (const [userId, assignments] of byUser) {
    for (let left = 0; left < assignments.length; left += 1) {
      for (let right = left + 1; right < assignments.length; right += 1) {
        const a = assignments[left].visit
        const b = assignments[right].visit
        if (a.scheduledStart < b.scheduledEnd && a.scheduledEnd > b.scheduledStart) {
          conflictPairs.set(`${userId}:${[a.id, b.id].sort().join(':')}`, assignments[left].user.email)
        }
      }
    }
  }
  assert(conflictPairs.size === 1, `expected exactly one future conflict case, found ${conflictPairs.size}`)
  assert([...conflictPairs.values()][0] === 'gabriel.moda@ds.ie', 'the deterministic conflict must belong to Gabriel Nunes Moda')

  const liveEntry = await prisma.timeEntry.findFirst({
    where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-live', status: 'running' },
    include: { locationEvents: true, visit: { include: { assignments: true } } },
  })
  assert(liveEntry, 'missing running Field Control timer')
  assert(liveEntry.startLocationClass === 'verified' && liveEntry.locationEvents.length >= 1, 'running timer must include verified GPS evidence')
  assert(liveEntry.visit?.assignments.some((assignment) => assignment.userId === liveEntry.userId && ACTIVE.includes(assignment.status as typeof ACTIVE[number])), 'live GPS timer must be linked to the same employee assigned to the visit')

  const reviewEntry = await prisma.timeEntry.findFirst({
    where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-review', status: 'needs_review' },
    include: { locationEvents: true, disputes: true, visit: { include: { assignments: true } } },
  })
  assert(reviewEntry, 'missing needs-review Field Control entry')
  assert(reviewEntry.startLocationClass === 'suspicious' && reviewEntry.disputes.some((dispute) => dispute.status === 'open'), 'review entry must include suspicious GPS and an open correction request')
  assert(reviewEntry.visit?.assignments.some((assignment) => assignment.userId === reviewEntry.userId), 'review GPS/time entry must be linked to the same employee and visit')

  const incident = await prisma.incident.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, title: { startsWith: 'Operational lab:' }, status: { notIn: ['resolved', 'closed'] } } })
  assert(incident?.severity === 'critical', 'missing deterministic critical Field Control incident')

  console.log('✓ Demo operational lab is coherent')
  console.log(`  People: ${configured.length} configured · ${homeMapped.length} mapped homes · ${contactReady.length} contact-ready · ${activePersonalLeave.length} active leave`)
  console.log(`  Map: ${sites.length} geocoded service sites · Aisha school origin configured`)
  console.log(`  Schedule: Liffey 0/2 · Greenpark 1/2 · exactly 1 pending confirmation · exactly 1 Gabriel conflict`)
  console.log(`  Integrity: ${futureAssignments.length} operational-lab assignments respect workforce + temporary availability rules`)
  console.log('  Field Control: live verified GPS linked to assignment · suspicious review entry + dispute · critical incident')
  console.log(`  Operational date: ${operationalDateKey(now, TZ)}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
