import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { calculateSupplyDueAt, getCategoryLabel } from '../src/lib/business-logic'
import { labelToDbCategory } from '../src/lib/mappers'
import { ADMIN_EMAIL, FEEDBACK_EMAIL } from '../src/lib/constants'
import {
  LEGACY_ORGANIZATION_ID,
  LEGACY_ORGANIZATION_SLUG,
  legacyRoleToMembershipRole,
} from '../src/lib/tenancy'

const prisma = new PrismaClient()

const TEST_PASSWORD = 'password123'

const USERS = [
  { email: 'admin@ds.ie', role: 'admin', name: 'Gabriel Nunes', status: 'active' },
  { email: 'super@ds.ie', role: 'supervisor', name: 'Sarah Johnson', status: 'active' },
  { email: 'employee@ds.ie', role: 'employee', name: 'Strikerlift', status: 'active' },
  { email: 'maria@ds.ie', role: 'employee', name: 'Maria Silva', status: 'active' },
  { email: 'john@ds.ie', role: 'employee', name: 'John Connor', status: 'active' },
  { email: 'emma@ds.ie', role: 'employee', name: 'Emma Wilson', status: 'active' },
  { email: 'michael@ds.ie', role: 'employee', name: 'Michael Brown', status: 'active' },
  { email: 'gabriel.moda@ds.ie', role: 'employee', name: 'Gabriel Nunes Moda', status: 'active' },
  { email: 'viewer@ds.ie', role: 'viewer', name: 'Viewer User', status: 'active' },
] as const

const EMPLOYEES = [
  'Strikerlift',
  'Maria Silva',
  'John Connor',
  'Emma Wilson',
  'Michael Brown',
  'Gabriel Nunes Moda',
] as const

const LOCATIONS = [
  'TechCorp Office - Dublin 2',
  'Green Bank - Temple Bar',
  'Blue Industries - Ballsbridge',
  'Red Company - Dun Laoghaire',
] as const

const PRODUCTS = [
  'All-purpose cleaner',
  'Toilet paper',
  'Paper towels',
  'Vacuum bags',
  'Microfiber cloths',
  'Hand sanitizer',
  'Bleach',
  'Rubber gloves',
  'Bin bags',
]

const NOTES = [
  'Please deliver before 9am.',
  'We are running low after the weekend.',
  'Client expects extra stock for tomorrow.',
  'Restock after the evening shift.',
  'Urgent for inspection prep.',
]

function pickWeighted<T>(entries: Array<{ value: T; weight: number }>): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = Math.random() * total
  for (const entry of entries) {
    roll -= entry.weight
    if (roll <= 0) return entry.value
  }
  return entries[entries.length - 1].value
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDateWithinDays(days: number): Date {
  const now = new Date()
  const offset = randomInt(0, days * 24 * 60 * 60 * 1000)
  return new Date(now.getTime() - offset)
}

function sampleProducts(): string[] {
  const count = randomInt(2, 4)
  const copy = [...PRODUCTS]
  const picks: string[] = []
  while (picks.length < count && copy.length > 0) {
    const index = randomInt(0, copy.length - 1)
    picks.push(copy.splice(index, 1)[0])
  }
  return picks
}

async function seedUsers(hash: string) {
  for (const user of USERS) {
    const savedUser = await prisma.user.upsert({
      where: { email: user.email },
      update: { password: hash, role: user.role, name: user.name, status: user.status },
      create: { email: user.email, password: hash, role: user.role, name: user.name, status: user.status },
    })
    await prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: LEGACY_ORGANIZATION_ID,
          userId: savedUser.id,
        },
      },
      update: { role: legacyRoleToMembershipRole(user.role), status: 'active' },
      create: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: savedUser.id,
        role: legacyRoleToMembershipRole(user.role),
        status: 'active',
      },
    })
  }
}

async function seedSupplies() {
  await prisma.supplyRequest.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  const [sites, visits, catalog] = await Promise.all([
    prisma.site.findMany({ where: { organizationId: LEGACY_ORGANIZATION_ID }, orderBy: { name: 'asc' } }),
    prisma.visit.findMany({ where: { organizationId: LEGACY_ORGANIZATION_ID }, orderBy: { scheduledStart: 'asc' } }),
    prisma.materialCatalogItem.findMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } }),
  ])
  const lifecycle = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit', 'Delivered'] as const
  const lifecycleNotes = ['Request submitted', 'Request triaged', 'Request approved', 'Order placed', 'Order dispatched', 'Delivery confirmed']

  for (let index = 0; index < 30; index += 1) {
    const priority = pickWeighted([
      { value: 'urgent' as const, weight: 40 },
      { value: 'normal' as const, weight: 35 },
      { value: 'low' as const, weight: 25 },
    ])
    const status = pickWeighted([
      { value: 'Requested' as const, weight: 25 },
      { value: 'Triaged' as const, weight: 15 },
      { value: 'Approved' as const, weight: 15 },
      { value: 'Ordered' as const, weight: 10 },
      { value: 'InTransit' as const, weight: 10 },
      { value: 'Delivered' as const, weight: 25 },
    ])
    const createdAt = randomDateWithinDays(90)
    const statusIndex = lifecycle.indexOf(status)
    const eventTimes = lifecycle.map((_, step) => new Date(createdAt.getTime() + step * randomInt(2, 18) * 3600 * 1000))
    const emailSentAt = statusIndex >= 2 ? eventTimes[2] : null
    const completedAt = status === 'Delivered' ? eventTimes[5] : null

    const notes = Math.random() < 0.45 ? NOTES[index % NOTES.length] : null
    const products = sampleProducts()
    const submittedBy = USERS[index % USERS.length].email
    const site = sites[index % sites.length]
    const visit = index % 3 === 0 ? visits[index % visits.length] : null
    const statusEvents = lifecycle.slice(0, statusIndex + 1).map((toStatus, step) => ({
      fromStatus: step ? lifecycle[step - 1] : null,
      toStatus,
      actorEmail: step ? 'admin@ds.ie' : submittedBy,
      note: lifecycleNotes[step],
      createdAt: eventTimes[step],
    }))

    await prisma.supplyRequest.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        employeeName: EMPLOYEES[index % EMPLOYEES.length],
        clientLocation: site?.name ?? LOCATIONS[index % LOCATIONS.length],
        siteId: site?.id,
        visitId: visit?.id,
        source: visit ? 'visit_check' : index % 4 === 0 ? 'stock_count' : 'manual',
        priority,
        products: JSON.stringify(products),
        items: { create: products.map((product) => ({ product, quantity: randomInt(1, 5), catalogItemId: catalog.find((item) => item.name.toLowerCase() === product.toLowerCase())?.id })) },
        statusEvents: { create: statusEvents },
        notes,
        status,
        submittedBy,
        createdAt,
        emailSentAt,
        completedAt,
        dueAt: calculateSupplyDueAt(priority, createdAt),
        assignedTo: index % 4 === 0 ? null : index % 2 === 0 ? 'admin@ds.ie' : 'super@ds.ie',
      },
    })
  }
}

async function seedFeedback() {
  await prisma.feedbackEntry.deleteMany()

  const ratingValues = [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0]

  const streakEmployees = ['Strikerlift', 'Emma Wilson']
  const feedback: Array<{
    employeeName: string
    employeeId: string
    clientLocation: string
    cleanliness: number
    punctuality: number
    equipment: number
    clientRelations: number
    overall: number
    category: string
    comments: string | null
    submittedBy: string
    createdAt: Date
  }> = []

  const employeeUsers = await prisma.user.findMany({
    where: { role: 'employee', status: 'active' },
    select: { id: true, name: true },
  })
  const employeeIds = new Map(employeeUsers.map((user) => [user.name, user.id]))

  for (let i = 0; i < 25; i += 1) {
    const employee = EMPLOYEES[i % EMPLOYEES.length]
    const employeeId = employeeIds.get(employee)
    if (!employeeId) throw new Error(`Missing seeded employee account for ${employee}`)
    const isStreak = streakEmployees.includes(employee) && i < 6
    const ratings = Array.from({ length: 4 }).map(() =>
      isStreak ? pickWeighted([{ value: 4.5, weight: 40 }, { value: 5.0, weight: 60 }]) : ratingValues[randomInt(0, ratingValues.length - 1)]
    )
    const overall = Number(((ratings[0] + ratings[1] + ratings[2] + ratings[3]) / 4).toFixed(1))
    const category = labelToDbCategory(getCategoryLabel(overall))

    feedback.push({
      employeeName: employee,
      employeeId,
      clientLocation: LOCATIONS[i % LOCATIONS.length],
      cleanliness: ratings[0],
      punctuality: ratings[1],
      equipment: ratings[2],
      clientRelations: ratings[3],
      overall,
      category,
      comments: Math.random() < 0.6 ? 'Great attention to detail.' : null,
      submittedBy: USERS[i % USERS.length].email,
      createdAt: randomDateWithinDays(90),
    })
  }

  await prisma.feedbackEntry.createMany({ data: feedback })
}

async function seedOperations() {
  const seededUsers = await prisma.user.findMany({
    where: { email: { in: ['admin@ds.ie', 'super@ds.ie', 'employee@ds.ie', 'maria@ds.ie'] } },
    select: { id: true, email: true },
  })
  const userIds = new Map(seededUsers.map((user) => [user.email, user.id]))
  const adminId = userIds.get('admin@ds.ie')
  const employeeId = userIds.get('employee@ds.ie')
  const mariaId = userIds.get('maria@ds.ie')
  if (!adminId || !employeeId || !mariaId) throw new Error('Missing operational demo users')

  const catalogSeed = [
    { sku: 'CHEM-APC-5L', name: 'All-purpose cleaner', category: 'Chemicals', unit: '5L container', defaultParLevel: 4, defaultReorderPoint: 2 },
    { sku: 'CHEM-DIS-5L', name: 'Disinfectant', category: 'Chemicals', unit: '5L container', defaultParLevel: 4, defaultReorderPoint: 2 },
    { sku: 'PAPER-TP-24', name: 'Toilet paper', category: 'Paper products', unit: 'case of 24', defaultParLevel: 8, defaultReorderPoint: 3 },
    { sku: 'PAPER-HT-12', name: 'Paper towels', category: 'Paper products', unit: 'case of 12', defaultParLevel: 6, defaultReorderPoint: 2 },
    { sku: 'WASTE-BAG-50', name: 'Bin bags', category: 'Waste', unit: 'roll of 50', defaultParLevel: 5, defaultReorderPoint: 2 },
    { sku: 'PPE-GLOVE-100', name: 'Nitrile gloves', category: 'PPE', unit: 'box of 100', defaultParLevel: 5, defaultReorderPoint: 2 },
    { sku: 'TOOLS-MICRO-10', name: 'Microfiber cloths', category: 'Tools', unit: 'pack of 10', defaultParLevel: 6, defaultReorderPoint: 2 },
    { sku: 'HYGIENE-SOAP-5L', name: 'Hand soap', category: 'Hygiene', unit: '5L container', defaultParLevel: 4, defaultReorderPoint: 1 },
  ]
  const catalog = []
  for (const item of catalogSeed) {
    catalog.push(await prisma.materialCatalogItem.upsert({
      where: { organizationId_sku: { organizationId: LEGACY_ORGANIZATION_ID, sku: item.sku } },
      update: { ...item, active: true },
      create: { organizationId: LEGACY_ORGANIZATION_ID, ...item },
    }))
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const locations = [
    {
      externalId: 'demo-techcorp', client: 'TechCorp Ireland', site: 'Grand Canal Office', addressLine1: '1 Grand Canal Square', city: 'Dublin', postalCode: 'D02 P820',
      latitude: 53.3441, longitude: -6.2383, startOffsetDays: 0, startMinutes: 9 * 60, workers: [employeeId, mariaId], preferredWorkers: [mariaId, employeeId], requiredWorkers: 2,
    },
    {
      externalId: 'demo-greenbank', client: 'Green Bank', site: 'Temple Bar Branch', addressLine1: '12 Essex Street East', city: 'Dublin', postalCode: 'D02 TD34',
      latitude: 53.3452, longitude: -6.2677, startOffsetDays: 1, startMinutes: 18 * 60, workers: [employeeId], preferredWorkers: [employeeId, mariaId], requiredWorkers: 1,
    },
    {
      externalId: 'demo-harbourview', client: 'Harbourview Legal', site: 'Docklands Suite', addressLine1: '2 Sir John Rogerson’s Quay', city: 'Dublin', postalCode: 'D02 R296',
      latitude: 53.3432, longitude: -6.2446, startOffsetDays: 2, startMinutes: 7 * 60 + 30, workers: [mariaId], preferredWorkers: [mariaId, employeeId], requiredWorkers: 2,
    },
    {
      externalId: 'demo-liffey', client: 'Liffey Media', site: 'Smithfield Studio', addressLine1: '7 Bow Street', city: 'Dublin', postalCode: 'D07 N9Y0',
      latitude: 53.3486, longitude: -6.2789, startOffsetDays: 3, startMinutes: 16 * 60, workers: [], preferredWorkers: [employeeId], requiredWorkers: 1,
    },
    {
      externalId: 'demo-rathmines', client: 'Rathmines Health', site: 'Wellness Centre', addressLine1: '18 Lower Rathmines Road', city: 'Dublin', postalCode: 'D06 X7W8',
      latitude: 53.3257, longitude: -6.2657, startOffsetDays: 4, startMinutes: 13 * 60 + 30, workers: [mariaId, employeeId], preferredWorkers: [employeeId, mariaId], requiredWorkers: 2,
    },
  ]

  for (const [siteIndex, location] of locations.entries()) {
    const client = await prisma.client.upsert({
      where: { organizationId_externalId: { organizationId: LEGACY_ORGANIZATION_ID, externalId: location.externalId } },
      update: { displayName: location.client, billingEmail: `facilities@${location.externalId.replace('demo-', '')}.example`, status: 'active' },
      create: { organizationId: LEGACY_ORGANIZATION_ID, externalId: location.externalId, displayName: location.client, billingEmail: `facilities@${location.externalId.replace('demo-', '')}.example` },
    })
    let site = await prisma.site.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id, name: location.site } })
    const siteData = {
      addressLine1: location.addressLine1, city: location.city, postalCode: location.postalCode,
      latitude: location.latitude, longitude: location.longitude, coordinateAccuracyM: 8, coordinateSource: 'gps_verified' as const,
      geofenceVerifiedM: 150, geofenceNearM: 250, geofenceSuspiciousM: 700, status: 'active' as const,
    }
    site = site
      ? await prisma.site.update({ where: { id: site.id }, data: siteData })
      : await prisma.site.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id, name: location.site, ...siteData } })

    await prisma.contact.upsert({
      where: { id: `demo-contact-${location.externalId}` },
      update: { clientId: client.id, name: `${location.client} Facilities`, role: 'Facilities manager', email: `facilities@${location.externalId.replace('demo-', '')}.example`, phone: '+353 1 555 01 00', isPrimary: true },
      create: { id: `demo-contact-${location.externalId}`, clientId: client.id, name: `${location.client} Facilities`, role: 'Facilities manager', email: `facilities@${location.externalId.replace('demo-', '')}.example`, phone: '+353 1 555 01 00', isPrimary: true },
    })
    const contractReference = `DS-${String(siteIndex + 1).padStart(3, '0')}-2026`
    const contract = await prisma.contract.upsert({
      where: { organizationId_reference: { organizationId: LEGACY_ORGANIZATION_ID, reference: contractReference } },
      update: { clientId: client.id, name: `${location.client} cleaning agreement`, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), currency: 'EUR', completionPolicy: { requiresEvidence: true, requiresReviewOnGpsException: true } },
      create: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id, name: `${location.client} cleaning agreement`, reference: contractReference, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), currency: 'EUR', completionPolicy: { requiresEvidence: true, requiresReviewOnGpsException: true } },
    })
    await prisma.contractSite.upsert({
      where: { contractId_siteId: { contractId: contract.id, siteId: site.id } },
      update: {},
      create: { contractId: contract.id, siteId: site.id },
    })

    await prisma.sitePreferredAssignee.deleteMany({ where: { siteId: site.id } })
    await prisma.sitePreferredAssignee.createMany({ data: location.preferredWorkers.map((userId, priority) => ({ organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, userId, priority })) })

    await prisma.siteAccess.upsert({
      where: { siteId: site.id },
      update: { entryInstructions: 'Use the staff entrance and sign in with reception.', parkingInstructions: 'Loading bay access for ten minutes.', hazards: ['Wet floors', 'Alarmed doors'], securityCloseDown: ['Close windows', 'Switch off lights', 'Set alarm', 'Lock main door'] },
      create: { siteId: site.id, entryInstructions: 'Use the staff entrance and sign in with reception.', parkingInstructions: 'Loading bay access for ten minutes.', hazards: ['Wet floors', 'Alarmed doors'], securityCloseDown: ['Close windows', 'Switch off lights', 'Set alarm', 'Lock main door'] },
    })

    const areaSeed = [
      { code: 'RECEPTION', name: 'Reception', type: 'room' as const },
      { code: 'OFFICE', name: 'Open office', type: 'zone' as const },
      { code: 'WASHROOM', name: 'Washrooms', type: 'room' as const },
      { code: 'KITCHEN', name: 'Kitchen', type: 'room' as const },
    ]
    const areas = []
    for (const [sortOrder, area] of areaSeed.entries()) {
      areas.push(await prisma.area.upsert({
        where: { siteId_code: { siteId: site.id, code: area.code } },
        update: { name: area.name, type: area.type, sortOrder, active: true },
        create: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, ...area, sortOrder },
      }))
    }

    for (const [materialIndex, item] of catalog.entries()) {
      const onHandPattern = siteIndex === 0 ? [1, 3, 2, 5, 0, 4, 6, 1] : [4, 1, 7, 2, 3, 1, 4, 3]
      await prisma.siteStockLevel.upsert({
        where: { siteId_catalogItemId: { siteId: site.id, catalogItemId: item.id } },
        update: { onHand: onHandPattern[materialIndex], parLevel: item.defaultParLevel, reorderPoint: item.defaultReorderPoint, estimatedDailyUse: materialIndex < 4 ? 0.7 : 0.3, lastCountedAt: new Date(), lastCountedBy: adminId },
        create: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, catalogItemId: item.id, onHand: onHandPattern[materialIndex], parLevel: item.defaultParLevel, reorderPoint: item.defaultReorderPoint, estimatedDailyUse: materialIndex < 4 ? 0.7 : 0.3, lastCountedAt: new Date(), lastCountedBy: adminId },
      })
    }

    let plan = await prisma.servicePlan.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: 'Regular office cleaning' } })
    plan = plan
      ? await prisma.servicePlan.update({ where: { id: plan.id }, data: { contractId: contract.id, status: 'published', expectedDurationMinutes: 120, requiredWorkers: location.requiredWorkers } })
      : await prisma.servicePlan.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, contractId: contract.id, siteId: site.id, name: 'Regular office cleaning', description: 'Area-based routine with evidence on critical outcomes.', status: 'published', expectedDurationMinutes: 120, requiredWorkers: location.requiredWorkers } })

    const taskSeed = [
      { area: areas[0], title: 'Clean entrance glass and reception touchpoints', critical: false, evidenceRequired: false },
      { area: areas[1], title: 'Vacuum floors and remove desk-area waste', critical: false, evidenceRequired: false },
      { area: areas[2], title: 'Clean and disinfect washrooms', critical: true, evidenceRequired: true },
      { area: areas[3], title: 'Sanitise kitchen and replenish consumables', critical: true, evidenceRequired: true },
      { area: areas[0], title: 'Complete security close-down', critical: true, evidenceRequired: false },
    ]
    const tasks = []
    for (const [sortOrder, task] of taskSeed.entries()) {
      let savedTask = await prisma.taskTemplate.findFirst({ where: { servicePlanId: plan.id, title: task.title } })
      const taskData = { areaId: task.area.id, instructions: 'Choose done, not applicable or problem. A problem requires a note and evidence.', responseType: 'done_na_problem' as const, critical: task.critical, required: true, evidenceRequired: task.evidenceRequired, evidenceVisibility: 'internal', sortOrder, active: true }
      savedTask = savedTask
        ? await prisma.taskTemplate.update({ where: { id: savedTask.id }, data: taskData })
        : await prisma.taskTemplate.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, servicePlanId: plan.id, title: task.title, ...taskData } })
      tasks.push(savedTask)
    }

    const contentHash = `demo-cleaning-v2-${location.externalId}-${location.requiredWorkers}`
    let version = await prisma.servicePlanVersion.findFirst({ where: { servicePlanId: plan.id, contentHash } })
    if (!version) {
      const latestVersion = await prisma.servicePlanVersion.aggregate({ where: { servicePlanId: plan.id }, _max: { versionNumber: true } })
      version = await prisma.servicePlanVersion.create({
        data: { organizationId: LEGACY_ORGANIZATION_ID, servicePlanId: plan.id, versionNumber: (latestVersion._max.versionNumber ?? 0) + 1, expectedDurationMinutes: 120, requiredWorkers: location.requiredWorkers, snapshot: { name: plan.name, tasks: taskSeed.map((task) => task.title) }, contentHash, publishedBy: adminId },
      })
    }
    const versionTasks = []
    for (const task of tasks) {
      let versionTask = await prisma.servicePlanVersionTask.findFirst({ where: { versionId: version.id, sourceTaskId: task.id } })
      if (!versionTask) {
        versionTask = await prisma.servicePlanVersionTask.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, versionId: version.id, sourceTaskId: task.id, sourceAreaId: task.areaId, areaName: areas.find((area) => area.id === task.areaId)?.name, title: task.title, instructions: task.instructions, responseType: task.responseType, critical: task.critical, required: task.required, evidenceRequired: task.evidenceRequired, evidenceVisibility: task.evidenceVisibility, sortOrder: task.sortOrder } })
      }
      versionTasks.push(versionTask)
    }

    let job = await prisma.job.findFirst({ where: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: 'Regular office cleaning' } })
    const scheduledStart = new Date(today.getTime() + location.startOffsetDays * 86_400_000 + location.startMinutes * 60_000)
    job = job
      ? await prisma.job.update({ where: { id: job.id }, data: { contractId: contract.id, servicePlanId: plan.id, servicePlanVersionId: version.id, status: 'active', startDate: scheduledStart, defaultStartMinutes: location.startMinutes, defaultDurationMin: 120, requiredWorkers: location.requiredWorkers } })
      : await prisma.job.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, contractId: contract.id, siteId: site.id, servicePlanId: plan.id, servicePlanVersionId: version.id, name: 'Regular office cleaning', status: 'active', recurrence: { frequency: 'weekly', interval: 1 }, startDate: scheduledStart, defaultStartMinutes: location.startMinutes, defaultDurationMin: 120, requiredWorkers: location.requiredWorkers, instructions: 'Review access notes, complete tasks by area and report shortages before leaving.' } })
    const generationKey = `demo-${scheduledStart.toISOString().slice(0, 10)}`
    const visit = await prisma.visit.upsert({
      where: { jobId_generationKey: { jobId: job.id, generationKey } },
      update: { scheduledStart, scheduledEnd: new Date(scheduledStart.getTime() + 120 * 60_000), status: 'dispatched', requiredWorkers: location.requiredWorkers, dispatchNotes: 'Check location guidance and acknowledge schedule changes before travel.' },
      create: { organizationId: LEGACY_ORGANIZATION_ID, jobId: job.id, siteId: site.id, servicePlanVersionId: version.id, scheduledStart, scheduledEnd: new Date(scheduledStart.getTime() + 120 * 60_000), status: 'dispatched', sequenceNumber: 1, generationKey, requiredWorkers: location.requiredWorkers, dispatchNotes: 'Check location guidance and acknowledge schedule changes before travel.' },
    })
    for (const workerId of location.workers) {
      await prisma.visitAssignment.upsert({
        where: { visitId_userId: { visitId: visit.id, userId: workerId } },
        update: { status: 'notified', notifiedAt: new Date() },
        create: { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, userId: workerId, status: 'notified', notifiedAt: new Date() },
      })
    }
    for (const versionTask of versionTasks) {
      await prisma.visitTaskResult.upsert({
        where: { visitId_versionTaskId: { visitId: visit.id, versionTaskId: versionTask.id } },
        update: {},
        create: { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, versionId: version.id, versionTaskId: versionTask.id },
      })
    }
  }
}

async function seedOperationalScenarios() {
  const users = await prisma.user.findMany({ where: { email: { in: USERS.map((user) => user.email) } }, select: { id: true, email: true, name: true } })
  const byEmail = new Map(users.map((user) => [user.email, user]))
  const admin = byEmail.get('admin@ds.ie')!
  const supervisor = byEmail.get('super@ds.ie')!
  const striker = byEmail.get('employee@ds.ie')!
  const maria = byEmail.get('maria@ds.ie')!
  const emma = byEmail.get('emma@ds.ie')!
  const visits = await prisma.visit.findMany({ where: { organizationId: LEGACY_ORGANIZATION_ID }, include: { site: true, taskResults: true }, orderBy: { scheduledStart: 'asc' } })
  if (!visits.length) return

  await prisma.correctiveAction.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.qualityInspectionItem.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.qualityInspection.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.visitReview.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.evidenceAsset.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.locationEvent.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.timeEntryDispute.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.timeEntry.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.incident.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.operationalNoticeRecipient.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.operationalNotice.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.availability.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.offlineMutation.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.mobileSession.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.devicePushToken.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.notificationJob.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })
  await prisma.auditLog.deleteMany({ where: { organizationId: LEGACY_ORGANIZATION_ID } })

  const now = new Date()
  const evidenceTargets = visits.slice(0, 3)
  for (const [index, visit] of visits.entries()) {
    const worker = [striker, maria, emma][index % 3]
    const startedAt = new Date(now.getTime() - (index + 2) * 86_400_000 - 2 * 3_600_000)
    const endedAt = new Date(startedAt.getTime() + (90 + index * 10) * 60_000)
    const status = index === 1 ? 'needs_review' : index === 3 ? 'approved' : 'completed'
    const distance = index === 1 ? 920 : index === 2 ? 310 : 42
    const locationClass = index === 1 ? 'suspicious' : index === 2 ? 'near' : 'verified'
    const entry = await prisma.timeEntry.create({ data: {
      organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, userId: worker.id, kind: 'visit', status,
      startedAt, endedAt, durationSeconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
      startLatitude: Number(visit.site.latitude ?? 53.344), startLongitude: Number(visit.site.longitude ?? -6.25), startAccuracyM: 12, startDistanceM: distance, startLocationClass: locationClass,
      endLatitude: Number(visit.site.latitude ?? 53.344), endLongitude: Number(visit.site.longitude ?? -6.25), endAccuracyM: 10, endDistanceM: Math.max(18, distance - 12), endLocationClass: locationClass,
      source: index === 2 ? 'offline_sync' : 'mobile', reviewReason: index === 1 ? 'Clock-in recorded outside the site verification band.' : null,
      approvedBy: status === 'approved' ? supervisor.id : null, approvedAt: status === 'approved' ? now : null,
    } })
    await prisma.locationEvent.createMany({ data: [
      { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, timeEntryId: entry.id, kind: 'clock_in', latitude: Number(visit.site.latitude ?? 53.344), longitude: Number(visit.site.longitude ?? -6.25), accuracyM: 12, distanceM: distance, classification: locationClass, capturedAt: startedAt },
      { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, timeEntryId: entry.id, kind: 'clock_out', latitude: Number(visit.site.latitude ?? 53.344), longitude: Number(visit.site.longitude ?? -6.25), accuracyM: 10, distanceM: Math.max(18, distance - 12), classification: locationClass, capturedAt: endedAt },
    ] })
    if (index === 1) await prisma.timeEntryDispute.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, timeEntryId: entry.id, userId: worker.id, reason: 'I was at the loading bay and GPS drifted outside the building.', status: 'open' } })
    if (index === 2) await prisma.incident.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, reportedBy: worker.id, category: 'materials', severity: 'high', title: 'Hand soap stock exhausted', description: 'Washroom dispensers were empty before service started. Supply replenishment is required.', status: 'in_progress' } })
    if (evidenceTargets.includes(visit)) {
      const task = visit.taskResults[0]
      if (task) await prisma.evidenceAsset.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, taskResultId: task.id, uploadedBy: worker.id, kind: 'photo', storageKey: `demo/${visit.id}/completion-${index + 1}.jpg`, fileName: `completion-${visit.site.name.toLowerCase().replaceAll(' ', '-')}.jpg`, mimeType: 'image/jpeg', sizeBytes: 242000 + index * 18000, visibility: index === 2 ? 'internal' : 'client_safe', latitude: Number(visit.site.latitude ?? 53.344), longitude: Number(visit.site.longitude ?? -6.25), capturedAt: endedAt, metadata: { demo: true, caption: 'Completion evidence' } } })
    }
    if (index === 0 || index === 3) await prisma.visitReview.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, visitId: visit.id, decision: index === 0 ? 'approved' : 'returned', note: index === 0 ? 'All completion evidence and checklist items verified.' : 'Please revisit the kitchen finish before closing.', reviewedBy: supervisor.id } })
  }

  const inspectionRows = [
    { visit: visits[0], score: 96, grade: 'A', passed: true, type: 'routine' as const, summary: 'Excellent handover and evidence quality.', result: 'pass' as const, critical: false },
    { visit: visits[Math.min(2, visits.length - 1)], score: 62, grade: 'D', passed: false, type: 'spot_check' as const, summary: 'Washroom and consumable standards need immediate correction.', result: 'fail' as const, critical: true },
    { visit: visits[Math.min(3, visits.length - 1)], score: 84, grade: 'B', passed: true, type: 'client_complaint' as const, summary: 'Follow-up completed; minor finish details remain.', result: 'fail' as const, critical: false },
  ]
  for (const [index, row] of inspectionRows.entries()) {
    const inspection = await prisma.qualityInspection.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, siteId: row.visit.siteId, visitId: row.visit.id, inspectorId: supervisor.id, type: row.type, status: index === 0 ? 'closed' : 'submitted', score: row.score, grade: row.grade, passed: row.passed, summary: row.summary, clientVisible: index !== 1, inspectedAt: new Date(now.getTime() - (index + 1) * 86_400_000), submittedAt: new Date(now.getTime() - index * 86_400_000), closedAt: index === 0 ? now : null } })
    const item = await prisma.qualityInspectionItem.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, inspectionId: inspection.id, category: index === 1 ? 'Washrooms' : 'Service finish', title: index === 1 ? 'Washroom hygiene and soap availability' : 'Final quality presentation', weight: 3, result: row.result, score: row.score, critical: row.critical, finding: row.result === 'fail' ? 'Evidence shows a missed standard during inspection.' : 'Standard consistently met.', requiredAction: row.result === 'fail' ? 'Return to site and verify correction.' : null, sortOrder: 0 } })
    if (row.result === 'fail') await prisma.correctiveAction.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, inspectionId: inspection.id, inspectionItemId: item.id, siteId: row.visit.siteId, visitId: row.visit.id, title: `Correct ${item.title}`, description: 'Resolve the inspection finding and attach evidence before closing.', severity: row.critical ? 'critical' : 'major', status: index === 1 ? 'in_progress' : 'open', assignedToId: maria.id, createdById: supervisor.id, dueAt: new Date(now.getTime() + (index + 1) * 86_400_000), acceptedAt: index === 1 ? now : null } })
  }

  const notice = await prisma.operationalNotice.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, siteId: visits[0].siteId, visitId: visits[0].id, type: 'site_instruction', priority: 'high', title: 'Reception access changed for evening teams', body: 'Use the loading-bay intercom after 18:00. Do not leave keys with reception.', requiresAcknowledgement: true, createdById: supervisor.id, expiresAt: new Date(now.getTime() + 14 * 86_400_000) } })
  await prisma.operationalNoticeRecipient.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, noticeId: notice.id, userId: striker.id, seenAt: now, acknowledgedAt: now, acknowledgement: 'Acknowledged — will use the loading-bay route.' },
    { organizationId: LEGACY_ORGANIZATION_ID, noticeId: notice.id, userId: maria.id },
    { organizationId: LEGACY_ORGANIZATION_ID, noticeId: notice.id, userId: emma.id, seenAt: now },
  ] })
  await prisma.availability.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, userId: striker.id, startsAt: new Date(now.getTime() + 2 * 86_400_000), endsAt: new Date(now.getTime() + 2 * 86_400_000 + 3 * 3_600_000), reason: 'Medical appointment' },
    { organizationId: LEGACY_ORGANIZATION_ID, userId: maria.id, startsAt: new Date(now.getTime() + 4 * 86_400_000), endsAt: new Date(now.getTime() + 5 * 86_400_000), reason: 'Annual leave' },
  ] })
  await prisma.mobileSession.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, userId: striker.id, deviceName: 'Strikerlift — Android', expiresAt: new Date(now.getTime() + 25 * 86_400_000) },
    { organizationId: LEGACY_ORGANIZATION_ID, userId: maria.id, deviceName: 'Maria — iPhone', expiresAt: new Date(now.getTime() + 20 * 86_400_000) },
  ] })
  await prisma.devicePushToken.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, userId: striker.id, token: 'demo-push-strikerlift', platform: 'android', deviceId: 'demo-android-01' },
    { organizationId: LEGACY_ORGANIZATION_ID, userId: maria.id, token: 'demo-push-maria', platform: 'ios', deviceId: 'demo-ios-01' },
  ] })
  await prisma.offlineMutation.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, userId: striker.id, clientMutationId: 'demo-offline-processed', deviceId: 'demo-android-01', mutationType: 'complete_task', entityId: visits[0].id, payload: { task: 'washrooms', result: 'done' }, status: 'processed', result: { synced: true }, clientCreatedAt: new Date(now.getTime() - 3 * 86_400_000), processedAt: new Date(now.getTime() - 3 * 86_400_000 + 2 * 60_000) },
    { organizationId: LEGACY_ORGANIZATION_ID, userId: maria.id, clientMutationId: 'demo-offline-failed', deviceId: 'demo-ios-01', mutationType: 'upload_evidence', entityId: visits[2].id, payload: { fileName: 'washroom-after.jpg' }, status: 'failed', error: 'Connection ended before upload; retry queued.', clientCreatedAt: new Date(now.getTime() - 86_400_000), processedAt: new Date(now.getTime() - 86_400_000 + 7 * 60_000) },
  ] })
  await prisma.notificationJob.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, kind: 'schedule_change', status: 'sent', payload: { message: 'Evening reception access changed', recipients: 3 }, entityType: 'operational_notice', entityId: notice.id, createdBy: supervisor.email, attempts: 1, sentAt: now },
    { organizationId: LEGACY_ORGANIZATION_ID, kind: 'supply_escalation', status: 'queued', payload: { site: visits[2]?.site.name, item: 'Hand soap', urgency: 'high' }, entityType: 'incident', entityId: visits[2]?.id, createdBy: maria.email, attempts: 0, nextAttemptAt: new Date(now.getTime() + 15 * 60_000) },
  ] })
  await prisma.auditLog.createMany({ data: [
    { organizationId: LEGACY_ORGANIZATION_ID, actorEmail: admin.email, action: 'demo_schedule_review', targetType: 'visit', targetId: visits[0].id, metadata: JSON.stringify({ decision: 'coverage confirmed' }) },
    { organizationId: LEGACY_ORGANIZATION_ID, actorEmail: supervisor.email, action: 'demo_quality_follow_up', targetType: 'quality_inspection', targetId: 'demo-quality', metadata: JSON.stringify({ action: 'corrective action created' }) },
    { organizationId: LEGACY_ORGANIZATION_ID, actorEmail: maria.email, action: 'demo_material_shortage', targetType: 'site', targetId: visits[2]?.siteId ?? visits[0].siteId, metadata: JSON.stringify({ category: 'hand soap' }) },
  ] })
}

async function main() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)
  await prisma.organization.upsert({
    where: { id: LEGACY_ORGANIZATION_ID },
    update: { name: 'Diamond Shine', slug: LEGACY_ORGANIZATION_SLUG, timezone: 'Europe/Dublin' },
    create: {
      id: LEGACY_ORGANIZATION_ID,
      name: 'Diamond Shine',
      slug: LEGACY_ORGANIZATION_SLUG,
      timezone: 'Europe/Dublin',
    },
  })
  await seedUsers(hash)
  await seedOperations()
  await seedSupplies()
  await seedFeedback()
  await seedOperationalScenarios()

  await prisma.notificationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: LEGACY_ORGANIZATION_ID,
        key: 'supply_alerts',
      },
    },
    update: { recipients: ADMIN_EMAIL },
    create: {
      organizationId: LEGACY_ORGANIZATION_ID,
      key: 'supply_alerts',
      recipients: ADMIN_EMAIL,
    },
  })
  await prisma.notificationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: LEGACY_ORGANIZATION_ID,
        key: 'feedback_alerts',
      },
    },
    update: { recipients: FEEDBACK_EMAIL },
    create: {
      organizationId: LEGACY_ORGANIZATION_ID,
      key: 'feedback_alerts',
      recipients: FEEDBACK_EMAIL,
    },
  })

  console.log('✅ Seed completed')
  console.log('Logins: admin@ds.ie, super@ds.ie, employee@ds.ie, viewer@ds.ie')
  console.log('Password: password123')
}

main()
  .catch((error) => {
    console.error('❌ Seed failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
