import { PrismaClient } from '@prisma/client'
import { assertDemoSeedAllowed } from '../src/lib/demo-seed-guard'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'
import { operationalDateKey, operationalInputToUtc } from '../src/lib/operational-time'

assertDemoSeedAllowed()

const prisma = new PrismaClient()
const TIMEZONE = 'Europe/Dublin'
const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const LAB_PREFIX = 'operational-lab:'

function operationalDay(date = new Date()) {
  const key = operationalDateKey(date, TIMEZONE)
  return {
    key,
    start: operationalInputToUtc(`${key}T00:00`, TIMEZONE),
    end: operationalInputToUtc(`${key}T23:59`, TIMEZONE),
  }
}

async function user(email: string) {
  return prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, email: true, name: true } })
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

async function upcomingVisits(externalId: string, days = 16) {
  const site = await scenarioSite(externalId)
  const from = operationalDay().start
  return prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      siteId: site.id,
      scheduledStart: { gte: from, lt: new Date(from.getTime() + days * DAY) },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
    },
    orderBy: { scheduledStart: 'asc' },
  })
}

async function setAssignments(
  visitId: string,
  assignments: Array<{ email: string; status: 'assigned' | 'seen' | 'acknowledged' }>,
) {
  await prisma.visitAssignment.deleteMany({ where: { visitId } })
  const now = new Date()
  for (const assignment of assignments) {
    const person = await user(assignment.email)
    await prisma.visitAssignment.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId,
        userId: person.id,
        status: assignment.status,
        notifiedAt: assignment.status === 'assigned' ? null : now,
        seenAt: assignment.status === 'seen' || assignment.status === 'acknowledged' ? now : null,
        acknowledgedAt: assignment.status === 'acknowledged' ? now : null,
      },
    })
  }
  const allAcknowledged = assignments.length > 0 && assignments.every((assignment) => assignment.status === 'acknowledged')
  await prisma.visit.update({
    where: { id: visitId },
    data: { status: assignments.length ? allAcknowledged ? 'acknowledged' : 'dispatched' : 'scheduled' },
  })
}

async function normalizeScenarioAcknowledgements() {
  const visits = await prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      scheduledStart: { gte: operationalDay().start },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
      job: { name: { startsWith: 'Scenario ·' } },
    },
    select: { id: true, assignments: { select: { id: true } } },
  })
  const now = new Date()
  for (const visit of visits) {
    if (!visit.assignments.length) {
      await prisma.visit.update({ where: { id: visit.id }, data: { status: 'scheduled' } })
      continue
    }
    await prisma.visitAssignment.updateMany({
      where: { visitId: visit.id },
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

async function seedScheduleHealthLab() {
  await normalizeScenarioAcknowledgements()

  const liffey = (await upcomingVisits('scenario-liffey-tech'))[0]
  const greenpark = (await upcomingVisits('scenario-greenpark-care'))[0]
  const merrion = (await upcomingVisits('scenario-merrion-dental'))[0]
  const beacon = (await upcomingVisits('scenario-beacon-fitness'))[0]
  const cedar = (await upcomingVisits('scenario-cedar-hotel'))[0]
  if (!liffey || !greenpark || !merrion || !beacon || !cedar) {
    throw new Error('Operational lab requires upcoming scenario visits. Run db:seed:scenarios first.')
  }

  await setAssignments(liffey.id, [])
  await setAssignments(greenpark.id, [{ email: 'niamh@ds.ie', status: 'acknowledged' }])
  await setAssignments(merrion.id, [
    { email: 'niamh@ds.ie', status: 'acknowledged' },
    { email: 'maria@ds.ie', status: 'assigned' },
  ])
  await setAssignments(beacon.id, [
    { email: 'aoife@ds.ie', status: 'acknowledged' },
    { email: 'john@ds.ie', status: 'acknowledged' },
  ])
  // Aisha is deliberately always in school. Keep Cedar operationally valid so
  // Capacity Finder can prove that choosing Aisha is blocked before a save.
  await setAssignments(cedar.id, [
    { email: 'liam@ds.ie', status: 'acknowledged' },
    { email: 'aoife@ds.ie', status: 'acknowledged' },
  ])

  const northstar = await upcomingVisits('scenario-northstar')
  const harbour = await upcomingVisits('scenario-harbour-retail')
  const harbourByDate = new Map(harbour.map((visit) => [operationalDateKey(visit.scheduledStart, TIMEZONE), visit]))
  const conflictNorthstar = northstar.find((visit) => harbourByDate.has(operationalDateKey(visit.scheduledStart, TIMEZONE)))
  if (!conflictNorthstar) throw new Error('Could not find a common Northstar/Harbour day for the conflict scenario.')
  const conflictHarbour = harbourByDate.get(operationalDateKey(conflictNorthstar.scheduledStart, TIMEZONE))!

  // Remove Gabriel from every other Harbour occurrence so the demo has one
  // isolated conflict case instead of a wall of repeated red cards.
  for (const visit of harbour) {
    if (visit.id === conflictHarbour.id) continue
    await setAssignments(visit.id, [
      { email: 'sofia@ds.ie', status: 'acknowledged' },
      { email: 'aoife@ds.ie', status: 'acknowledged' },
    ])
  }
  await setAssignments(conflictNorthstar.id, [
    { email: 'gabriel.moda@ds.ie', status: 'acknowledged' },
    { email: 'lucas@ds.ie', status: 'acknowledged' },
  ])
  await setAssignments(conflictHarbour.id, [
    { email: 'gabriel.moda@ds.ie', status: 'acknowledged' },
    { email: 'sofia@ds.ie', status: 'acknowledged' },
  ])
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
        phone: `+353 86 700 ${String(1000 + index).slice(-4)}`,
        emergencyContactName: `Demo emergency contact ${index + 1}`,
        emergencyContactPhone: `+353 87 710 ${String(2000 + index).slice(-4)}`,
        employmentStartDate: new Date(Date.UTC(2024 + (index % 2), index % 12, 1)),
      },
    })
  }
}

async function ensureLabVisit(
  externalId: string,
  suffix: string,
  start: Date,
  end: Date,
  status: 'acknowledged' | 'in_progress' | 'completed',
  assigneeEmail: string,
) {
  const { site, job, version } = await scenarioJob(externalId)
  const generationKey = `${LAB_PREFIX}${suffix}:${operationalDay(start).key}`
  const visit = await prisma.visit.upsert({
    where: { jobId_generationKey: { jobId: job.id, generationKey } },
    update: {
      scheduledStart: start,
      scheduledEnd: end,
      status,
      startedAt: status === 'in_progress' ? start : null,
      completedAt: status === 'completed' ? end : null,
      requiredWorkers: 1,
    },
    create: {
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
    },
  })
  await setAssignments(visit.id, [{ email: assigneeEmail, status: 'acknowledged' }])
  await prisma.visit.update({
    where: { id: visit.id },
    data: {
      status,
      startedAt: status === 'in_progress' ? start : null,
      completedAt: status === 'completed' ? end : null,
    },
  })
  return { visit, site, version, person: await user(assigneeEmail) }
}

async function seedFieldControlLab() {
  const now = new Date()
  const liveStart = new Date(now.getTime() - 30 * 60_000)
  const liveEnd = new Date(now.getTime() + 90 * 60_000)
  const live = await ensureLabVisit('scenario-beacon-fitness', 'live', liveStart, liveEnd, 'in_progress', 'aoife@ds.ie')

  await prisma.timeEntry.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-live' } })
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
      clientMutationId: `${LAB_PREFIX}live-timer:${operationalDay().key}`,
    },
  })
  await prisma.locationEvent.deleteMany({ where: { timeEntryId: liveEntry.id } })
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

  await prisma.incident.deleteMany({
    where: { organizationId: LEGACY_ORGANIZATION_ID, title: { startsWith: 'Operational lab:' } },
  })
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
  await prisma.timeEntry.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID, source: 'operational-lab-review' } })
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
      clientMutationId: `${LAB_PREFIX}review-timer:${operationalDay().key}`,
    },
  })
  await prisma.timeEntryDispute.deleteMany({ where: { timeEntryId: reviewEntry.id } })
  await prisma.timeEntryDispute.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      timeEntryId: reviewEntry.id,
      userId: review.person.id,
      reason: 'Operational lab: GPS was still settling when I clocked in.',
      status: 'open',
    },
  })
  await prisma.locationEvent.deleteMany({ where: { timeEntryId: reviewEntry.id } })
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
    const result = await prisma.visitTaskResult.upsert({
      where: { visitId_versionTaskId: { visitId: review.visit.id, versionTaskId: versionTask.id } },
      update: { status: 'done', completedBy: review.person.id, completedAt: reviewEnd },
      create: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: review.visit.id,
        versionId: review.version.id,
        versionTaskId: versionTask.id,
        status: 'done',
        completedBy: review.person.id,
        completedAt: reviewEnd,
      },
    })
    await prisma.evidenceAsset.deleteMany({
      where: { visitId: review.visit.id, storageKey: { startsWith: 'operational-lab/' } },
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
  await seedPeopleProfileDetails()
  await seedScheduleHealthLab()
  await seedFieldControlLab()
  console.log('Operational lab ready: deterministic Schedule Health, Capacity, People/Map and Field Control scenarios.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
