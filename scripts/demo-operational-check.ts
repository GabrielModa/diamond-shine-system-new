import { PrismaClient } from '@prisma/client'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'
import { operationalDateKey } from '../src/lib/operational-time'

const prisma = new PrismaClient()
const TZ = 'Europe/Dublin'
const ACTIVE = ['assigned', 'notified', 'seen', 'acknowledged'] as const

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
    },
    include: { assignments: true },
    orderBy: { scheduledStart: 'asc' },
  })
  assert(visit, `missing upcoming visit for ${externalId}`)
  return visit
}

async function main() {
  const employees = await prisma.user.findMany({
    where: {
      status: 'active',
      memberships: { some: { organizationId: LEGACY_ORGANIZATION_ID, status: 'active', role: { in: ['employee', 'field_supervisor'] } } },
    },
    include: { workforceProfile: { include: { studySchedules: true, leaves: true } } },
  })
  assert(employees.length >= 15, `expected at least 15 operational people, found ${employees.length}`)
  const configured = employees.filter((employee) => employee.workforceProfile?.weeklyTargetConfigured)
  assert(configured.length >= 15, `expected at least 15 configured workforce profiles, found ${configured.length}`)
  const homeMapped = configured.filter((employee) => employee.workforceProfile?.homeLatitude != null && employee.workforceProfile.homeLongitude != null)
  assert(homeMapped.length >= 15, `expected at least 15 home map origins, found ${homeMapped.length}`)

  const sites = await prisma.site.findMany({
    where: { organizationId: LEGACY_ORGANIZATION_ID, status: 'active', latitude: { not: null }, longitude: { not: null } },
  })
  assert(sites.length >= 10, `expected at least 10 geocoded service sites, found ${sites.length}`)

  const aisha = employees.find((employee) => employee.email === 'aisha@ds.ie')
  assert(aisha?.workforceProfile?.schoolLatitude != null, 'Aisha must have a mapped school origin')
  assert(aisha.workforceProfile.studySchedules.some((rule) => rule.startsMinute === 0 && rule.endsMinute === 1440), 'Aisha must keep the all-day school test schedule')

  const activePersonalLeave = configured.filter((employee) => employee.workforceProfile?.leaves.some((leave) => leave.kind === 'personal_leave' && leave.startsAt <= new Date() && leave.endsAt > new Date()))
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

  const gabriel = await prisma.user.findUniqueOrThrow({ where: { email: 'gabriel.moda@ds.ie' } })
  const gabrielAssignments = await prisma.visitAssignment.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: gabriel.id,
      status: { in: [...ACTIVE] },
      visit: { scheduledStart: { gte: new Date() }, status: { notIn: ['cancelled', 'completed', 'missed'] } },
    },
    include: { visit: { select: { id: true, scheduledStart: true, scheduledEnd: true, site: { select: { name: true } } } } },
    orderBy: { visit: { scheduledStart: 'asc' } },
  })
  const conflictPairs = new Set<string>()
  for (let left = 0; left < gabrielAssignments.length; left += 1) {
    for (let right = left + 1; right < gabrielAssignments.length; right += 1) {
      const a = gabrielAssignments[left].visit
      const b = gabrielAssignments[right].visit
      if (a.scheduledStart < b.scheduledEnd && a.scheduledEnd > b.scheduledStart) {
        conflictPairs.add([a.id, b.id].sort().join(':'))
      }
    }
  }
  assert(conflictPairs.size >= 1, 'Gabriel must have at least one deterministic overlap case')

  const liveEntry = await prisma.timeEntry.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-live', status: 'running' }, include: { locationEvents: true } })
  assert(liveEntry, 'missing running Field Control timer')
  assert(liveEntry.startLocationClass === 'verified' && liveEntry.locationEvents.length >= 1, 'running timer must include verified GPS evidence')

  const reviewEntry = await prisma.timeEntry.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-review', status: 'needs_review' }, include: { locationEvents: true, disputes: true } })
  assert(reviewEntry, 'missing needs-review Field Control entry')
  assert(reviewEntry.startLocationClass === 'suspicious' && reviewEntry.disputes.some((dispute) => dispute.status === 'open'), 'review entry must include suspicious GPS and an open correction request')

  const incident = await prisma.incident.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, title: { startsWith: 'Operational lab:' }, status: { notIn: ['resolved', 'closed'] } } })
  assert(incident?.severity === 'critical', 'missing deterministic critical Field Control incident')

  console.log('✓ Demo operational lab is coherent')
  console.log(`  People: ${configured.length} configured · ${homeMapped.length} mapped homes · ${activePersonalLeave.length} active leave scenarios`)
  console.log(`  Map: ${sites.length} geocoded service sites · Aisha school origin configured`)
  console.log(`  Schedule: Liffey 0/2 · Greenpark 1/2 · Merrion pending confirmation · ${conflictPairs.size} Gabriel overlap case(s)`)
  console.log(`  Field Control: live verified timer · suspicious review entry · critical incident`)
  console.log(`  Operational date: ${operationalDateKey(new Date(), TZ)}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
