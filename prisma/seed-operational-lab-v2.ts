import { PrismaClient } from '@prisma/client'
import { assertDemoSeedAllowed } from '../src/lib/demo-seed-guard'
import { operationalDateKey } from '../src/lib/operational-time'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../src/modules/scheduling/assignment-lifecycle'
import { buildDefaultTeamAllocator } from '../src/modules/scheduling/default-team'

assertDemoSeedAllowed()

const prisma = new PrismaClient()
const TIMEZONE = 'Europe/Dublin'
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const LAB_PREFIX = 'operational-lab:'
const RESERVED_EMAILS = ['gabriel.moda@ds.ie', 'priya@ds.ie']

type AssignmentSeed = { userId: string; status: 'assigned' | 'acknowledged' }

async function user(email: string) {
  return prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, email: true, name: true, workforceProfile: { select: { id: true } } },
  })
}

async function scenarioSite(externalId: string) {
  const client = await prisma.client.findUniqueOrThrow({
    where: { organizationId_externalId: { organizationId: LEGACY_ORGANIZATION_ID, externalId } },
    select: { id: true, displayName: true },
  })
  return prisma.site.findFirstOrThrow({
    where: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      client: { select: { displayName: true } },
    },
  })
}

async function scenarioJob(externalId: string) {
  const site = await scenarioSite(externalId)
  const job = await prisma.job.findFirstOrThrow({
    where: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: { startsWith: 'Scenario ·' } },
    include: { servicePlanVersion: true },
  })
  if (!job.servicePlanVersion) throw new Error(`Scenario job ${job.name} has no published service plan version.`)
  return { site, job, version: job.servicePlanVersion }
}

async function cleanupPreviousLab() {
  const labVisits = await prisma.visit.findMany({
    where: { organizationId: LEGACY_ORGANIZATION_ID, generationKey: { startsWith: LAB_PREFIX } },
    select: { id: true },
  })
  const visitIds = labVisits.map((visit) => visit.id)
  if (!visitIds.length) return
  const entries = await prisma.timeEntry.findMany({ where: { visitId: { in: visitIds } }, select: { id: true } })
  const entryIds = entries.map((entry) => entry.id)
  if (entryIds.length) {
    await prisma.timeEntryDispute.deleteMany({ where: { timeEntryId: { in: entryIds } } })
    await prisma.locationEvent.deleteMany({ where: { timeEntryId: { in: entryIds } } })
  }
  await prisma.locationEvent.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.timeEntry.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.evidenceAsset.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.incident.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.visitTaskResult.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.visitAssignment.deleteMany({ where: { visitId: { in: visitIds } } })
  await prisma.visit.deleteMany({ where: { id: { in: visitIds } } })
}

async function seedPeopleProfileDetails() {
  const emails = [
    'employee@ds.ie', 'maria@ds.ie', 'john@ds.ie', 'emma@ds.ie', 'michael@ds.ie',
    'gabriel.moda@ds.ie', 'aoife@ds.ie', 'liam@ds.ie', 'niamh@ds.ie', 'omar@ds.ie',
    'sofia@ds.ie', 'daniel@ds.ie', 'priya@ds.ie', 'lucas@ds.ie', 'aisha@ds.ie',
  ]
  for (const [index, email] of emails.entries()) {
    const person = await user(email)
    await prisma.workforceProfile.update({
      where: { userId: person.id },
      data: {
        phone: `+35386700${String(1000 + index).slice(-4)}`,
        emergencyContactName: `Demo emergency contact ${index + 1}`,
        emergencyContactPhone: `+35387710${String(2000 + index).slice(-4)}`,
        employmentStartDate: new Date(Date.UTC(2024 + (index % 2), index % 12, 1)),
      },
    })
  }
}

async function reserveDeterministicWorkers() {
  const gabriel = await user('gabriel.moda@ds.ie')
  if (gabriel.workforceProfile) {
    await prisma.recurringUnavailability.deleteMany({
      where: { profileId: gabriel.workforceProfile.id, reason: { startsWith: 'Scenario matrix:' } },
    })
  }
  await prisma.availability.deleteMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: gabriel.id,
      reason: { startsWith: 'Scenario matrix:' },
    },
  })
}

async function acknowledgeExistingFutureAssignments() {
  const visits = await prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      scheduledStart: { gte: new Date() },
      status: { notIn: ['cancelled', 'completed', 'missed', 'in_progress', 'completion_blocked'] },
    },
    include: { assignments: true },
  })
  const now = new Date()
  for (const visit of visits) {
    const active = visit.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
    if (!active.length) continue
    await prisma.visitAssignment.updateMany({
      where: { id: { in: active.map((assignment) => assignment.id) } },
      data: {
        status: 'acknowledged',
        notifiedAt: now,
        seenAt: now,
        acknowledgedAt: now,
        declinedAt: null,
        declineReason: null,
      },
    })
    await prisma.visit.update({ where: { id: visit.id }, data: { status: 'acknowledged' } })
  }
}

async function normalizeFutureScenarioAssignments() {
  const from = new Date()
  const to = new Date(from.getTime() + 16 * DAY)
  const visits = await prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      scheduledStart: { gte: from, lt: to },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
      job: { name: { startsWith: 'Scenario ·' } },
    },
    include: { site: { select: { name: true, client: { select: { displayName: true } } } } },
    orderBy: { scheduledStart: 'asc' },
  })
  if (!visits.length) throw new Error('No future scenario visits found. Run db:seed:scenarios before the operational lab.')

  const reserved = await prisma.user.findMany({ where: { email: { in: RESERVED_EMAILS } }, select: { id: true } })
  const reservedIds = new Set(reserved.map((person) => person.id))
  const candidates = await prisma.membership.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      status: 'active',
      role: { in: ['employee', 'field_supervisor'] },
      user: {
        status: 'active',
        workforceProfile: { is: { weeklyTargetConfigured: true } },
      },
    },
    select: { userId: true },
  })
  const candidateIds = candidates.map((membership) => membership.userId).filter((id) => !reservedIds.has(id))

  await prisma.$transaction(async (tx) => {
    const visitIds = visits.map((visit) => visit.id)
    await tx.visitAssignment.deleteMany({ where: { visitId: { in: visitIds } } })
    await tx.visit.updateMany({ where: { id: { in: visitIds } }, data: { status: 'scheduled' } })

    const maxEnd = new Date(Math.max(...visits.map((visit) => visit.scheduledEnd.getTime())))
    const allocator = await buildDefaultTeamAllocator(tx, {
      organizationId: LEGACY_ORGANIZATION_ID,
      userIds: candidateIds,
      from: visits[0].scheduledStart,
      to: maxEnd,
      timezone: TIMEZONE,
    })
    const acknowledgedAt = new Date()
    for (const visit of visits) {
      const selected = allocator.select(visit.scheduledStart, visit.scheduledEnd, visit.requiredWorkers)
      if (selected.length !== visit.requiredWorkers) {
        throw new Error(
          `Operational lab could not safely cover ${visit.site.client.displayName} · ${visit.site.name} ` +
          `at ${visit.scheduledStart.toISOString()} (${selected.length}/${visit.requiredWorkers}).`,
        )
      }
      await tx.visitAssignment.createMany({
        data: selected.map((userId) => ({
          organizationId: LEGACY_ORGANIZATION_ID,
          visitId: visit.id,
          userId,
          status: 'acknowledged' as const,
          notifiedAt: acknowledgedAt,
          seenAt: acknowledgedAt,
          acknowledgedAt,
        })),
      })
      await tx.visit.update({ where: { id: visit.id }, data: { status: 'acknowledged' } })
    }
  }, { timeout: 60_000 })

  return visits.length
}

async function upcomingVisits(externalId: string, days = 16) {
  const site = await scenarioSite(externalId)
  const from = new Date()
  return prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      siteId: site.id,
      scheduledStart: { gte: from, lt: new Date(from.getTime() + days * DAY) },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
      job: { name: { startsWith: 'Scenario ·' } },
    },
    include: { assignments: true },
    orderBy: { scheduledStart: 'asc' },
  })
}

async function setAssignmentsByUserId(visitId: string, assignments: AssignmentSeed[]) {
  await prisma.visitAssignment.deleteMany({ where: { visitId } })
  const now = new Date()
  if (assignments.length) {
    await prisma.visitAssignment.createMany({
      data: assignments.map((assignment) => ({
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId,
        userId: assignment.userId,
        status: assignment.status,
        notifiedAt: assignment.status === 'acknowledged' ? now : null,
        seenAt: assignment.status === 'acknowledged' ? now : null,
        acknowledgedAt: assignment.status === 'acknowledged' ? now : null,
      })),
    })
  }
  const allAcknowledged = assignments.length > 0 && assignments.every((assignment) => assignment.status === 'acknowledged')
  await prisma.visit.update({
    where: { id: visitId },
    data: { status: assignments.length ? allAcknowledged ? 'acknowledged' : 'dispatched' : 'scheduled' },
  })
}

async function seedScheduleHealthLab() {
  const liffey = (await upcomingVisits('scenario-liffey-tech'))[0]
  const greenpark = (await upcomingVisits('scenario-greenpark-care'))[0]
  const merrion = (await upcomingVisits('scenario-merrion-dental'))[0]
  if (!liffey || !greenpark || !merrion) throw new Error('Missing future visits required by the Schedule Health lab.')

  await setAssignmentsByUserId(liffey.id, [])
  await prisma.visit.update({ where: { id: liffey.id }, data: { dispatchNotes: 'Operational lab: deterministic 0/2 staffing gap.' } })

  const greenparkBaseline = greenpark.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
  if (!greenparkBaseline[0]) throw new Error('Greenpark baseline must have a valid cleaner before creating the 1/2 scenario.')
  await setAssignmentsByUserId(greenpark.id, [{ userId: greenparkBaseline[0].userId, status: 'acknowledged' }])
  await prisma.visit.update({ where: { id: greenpark.id }, data: { dispatchNotes: 'Operational lab: deterministic 1/2 staffing gap.' } })

  const merrionBaseline = merrion.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status))
  if (merrionBaseline.length < 2) throw new Error('Merrion baseline must have two valid cleaners before creating pending confirmation.')
  await setAssignmentsByUserId(merrion.id, [
    { userId: merrionBaseline[0].userId, status: 'acknowledged' },
    { userId: merrionBaseline[1].userId, status: 'assigned' },
  ])
  await prisma.visit.update({ where: { id: merrion.id }, data: { dispatchNotes: 'Operational lab: one cleaner still needs to confirm.' } })

  const northstar = await upcomingVisits('scenario-northstar')
  const harbour = await upcomingVisits('scenario-harbour-retail')
  const harbourByDate = new Map(harbour.map((visit) => [operationalDateKey(visit.scheduledStart, TIMEZONE), visit]))
  const conflictNorthstar = northstar.find((visit) => harbourByDate.has(operationalDateKey(visit.scheduledStart, TIMEZONE)))
  if (!conflictNorthstar) throw new Error('Could not find a common future Northstar/Harbour day for the conflict scenario.')
  const conflictHarbour = harbourByDate.get(operationalDateKey(conflictNorthstar.scheduledStart, TIMEZONE))!
  const gabriel = await user('gabriel.moda@ds.ie')
  const northstarOther = conflictNorthstar.assignments.find((assignment) => assignment.userId !== gabriel.id)
  const harbourOther = conflictHarbour.assignments.find((assignment) => assignment.userId !== gabriel.id)
  if (!northstarOther || !harbourOther) throw new Error('Conflict target visits need a valid baseline cleaner alongside Gabriel.')

  await setAssignmentsByUserId(conflictNorthstar.id, [
    { userId: gabriel.id, status: 'acknowledged' },
    { userId: northstarOther.userId, status: 'acknowledged' },
  ])
  await setAssignmentsByUserId(conflictHarbour.id, [
    { userId: gabriel.id, status: 'acknowledged' },
    { userId: harbourOther.userId, status: 'acknowledged' },
  ])
  await prisma.visit.update({ where: { id: conflictNorthstar.id }, data: { dispatchNotes: 'Operational lab: Gabriel conflict A.' } })
  await prisma.visit.update({ where: { id: conflictHarbour.id }, data: { dispatchNotes: 'Operational lab: Gabriel conflict B.' } })
}

async function ensureLabVisit(
  externalId: string,
  suffix: string,
  start: Date,
  end: Date,
  status: 'in_progress' | 'completed',
  assigneeEmail: string,
) {
  const { site, job, version } = await scenarioJob(externalId)
  const person = await user(assigneeEmail)
  const generationKey = `${LAB_PREFIX}${suffix}:${operationalDateKey(start, TIMEZONE)}`
  const visit = await prisma.visit.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      jobId: job.id,
      siteId: site.id,
      servicePlanVersionId: version.id,
      scheduledStart: start,
      scheduledEnd: end,
      timezone: TIMEZONE,
      status,
      sequenceNumber: suffix === 'live' ? 9001 : 9002,
      generationKey,
      requiredWorkers: 1,
      startedAt: status === 'in_progress' ? start : null,
      completedAt: status === 'completed' ? end : null,
      assignments: {
        create: {
          organizationId: LEGACY_ORGANIZATION_ID,
          userId: person.id,
          status: 'acknowledged',
          notifiedAt: new Date(),
          seenAt: new Date(),
          acknowledgedAt: new Date(),
        },
      },
    },
  })
  return { visit, site, version, person }
}

async function seedFieldControlLab() {
  const now = new Date()
  const liveStart = new Date(now.getTime() - 30 * 60_000)
  const liveEnd = new Date(now.getTime() + 90 * 60_000)
  // Priya is reserved from the scenario allocator and is on a current school
  // holiday, giving us a clean live-field scenario without adding a Schedule conflict.
  const live = await ensureLabVisit('scenario-beacon-fitness', 'live', liveStart, liveEnd, 'in_progress', 'priya@ds.ie')
  const liveEntry = await prisma.timeEntry.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      visitId: live.visit.id,
      userId: live.person.id,
      kind: 'visit',
      status: 'running',
      startedAt: liveStart,
      startLatitude: live.site.latitude,
      startLongitude: live.site.longitude,
      startAccuracyM: 9,
      startDistanceM: 18,
      startLocationClass: 'verified',
      source: 'operational-lab-live',
      clientMutationId: `${LAB_PREFIX}live-timer:${operationalDateKey(now, TIMEZONE)}`,
    },
  })
  if (live.site.latitude != null && live.site.longitude != null) {
    await prisma.locationEvent.createMany({ data: [
      {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: live.visit.id,
        timeEntryId: liveEntry.id,
        kind: 'clock_in',
        latitude: live.site.latitude,
        longitude: live.site.longitude,
        accuracyM: 9,
        distanceM: 18,
        classification: 'verified',
        capturedAt: liveStart,
        source: 'operational-lab',
      },
      {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: live.visit.id,
        timeEntryId: liveEntry.id,
        kind: 'heartbeat',
        latitude: live.site.latitude,
        longitude: live.site.longitude,
        accuracyM: 12,
        distanceM: 22,
        classification: 'verified',
        capturedAt: new Date(now.getTime() - 5 * 60_000),
        source: 'operational-lab',
      },
    ] })
  }
  await prisma.incident.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      visitId: live.visit.id,
      reportedBy: live.person.id,
      category: 'access',
      severity: 'critical',
      title: 'Operational lab: access door blocked',
      description: 'Deterministic critical incident for Field Control testing.',
      status: 'open',
    },
  })

  const reviewEnd = new Date(now.getTime() - 2 * HOUR)
  const reviewStart = new Date(reviewEnd.getTime() - 2 * HOUR)
  const review = await ensureLabVisit('scenario-merrion-dental', 'review', reviewStart, reviewEnd, 'completed', 'niamh@ds.ie')
  const reviewEntry = await prisma.timeEntry.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      visitId: review.visit.id,
      userId: review.person.id,
      kind: 'visit',
      status: 'needs_review',
      startedAt: reviewStart,
      endedAt: reviewEnd,
      durationSeconds: 2 * 3600,
      startLatitude: review.site.latitude,
      startLongitude: review.site.longitude,
      startAccuracyM: 45,
      startDistanceM: 920,
      startLocationClass: 'suspicious',
      endLatitude: review.site.latitude,
      endLongitude: review.site.longitude,
      endAccuracyM: 24,
      endDistanceM: 40,
      endLocationClass: 'near',
      reviewReason: 'Operational lab: clock-in captured 920m from site.',
      source: 'operational-lab-review',
      clientMutationId: `${LAB_PREFIX}review-timer:${operationalDateKey(now, TIMEZONE)}`,
    },
  })
  await prisma.timeEntryDispute.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      timeEntryId: reviewEntry.id,
      userId: review.person.id,
      reason: 'Operational lab: GPS was still settling when I clocked in.',
      status: 'open',
    },
  })
  if (review.site.latitude != null && review.site.longitude != null) {
    await prisma.locationEvent.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: review.visit.id,
        timeEntryId: reviewEntry.id,
        kind: 'clock_in',
        latitude: review.site.latitude,
        longitude: review.site.longitude,
        accuracyM: 45,
        distanceM: 920,
        classification: 'suspicious',
        capturedAt: reviewStart,
        source: 'operational-lab',
      },
    })
  }

  const versionTask = await prisma.servicePlanVersionTask.findFirst({ where: { versionId: review.version.id } })
  if (versionTask) {
    const result = await prisma.visitTaskResult.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: review.visit.id,
        versionId: review.version.id,
        versionTaskId: versionTask.id,
        status: 'done',
        completedBy: review.person.id,
        completedAt: reviewEnd,
      },
    })
    await prisma.evidenceAsset.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: review.visit.id,
        taskResultId: result.id,
        uploadedBy: review.person.id,
        kind: 'photo',
        storageKey: `operational-lab/${review.visit.id}/completion.jpg`,
        fileName: 'operational-lab-completion.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 128_000,
        visibility: 'internal',
        latitude: review.site.latitude,
        longitude: review.site.longitude,
        capturedAt: reviewEnd,
        metadata: { demo: true, purpose: 'field-control-review' },
      },
    })
  }
}

async function main() {
  await cleanupPreviousLab()
  await seedPeopleProfileDetails()
  await reserveDeterministicWorkers()
  await acknowledgeExistingFutureAssignments()
  const normalizedVisits = await normalizeFutureScenarioAssignments()
  await seedScheduleHealthLab()
  await seedFieldControlLab()
  console.log(
    `Operational lab ready: ${normalizedVisits} future scenario visits safely allocated; ` +
    'Schedule Health, Capacity, People/Map and Field Control exceptions are deterministic.',
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
