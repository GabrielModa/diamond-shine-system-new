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
  await prisma.supplyRequest.deleteMany()
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
    const statusEvents = lifecycle.slice(0, statusIndex + 1).map((toStatus, step) => ({
      fromStatus: step ? lifecycle[step - 1] : null,
      toStatus,
      actorEmail: step ? 'admin@ds.ie' : submittedBy,
      note: lifecycleNotes[step],
      createdAt: eventTimes[step],
    }))

    await prisma.supplyRequest.create({
      data: {
        employeeName: EMPLOYEES[index % EMPLOYEES.length],
        clientLocation: LOCATIONS[index % LOCATIONS.length],
        priority,
        products: JSON.stringify(products),
        items: { create: products.map((product) => ({ product, quantity: randomInt(1, 5) })) },
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
      ? await prisma.servicePlan.update({ where: { id: plan.id }, data: { status: 'published', expectedDurationMinutes: 120, requiredWorkers: location.requiredWorkers } })
      : await prisma.servicePlan.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: 'Regular office cleaning', description: 'Area-based routine with evidence on critical outcomes.', status: 'published', expectedDurationMinutes: 120, requiredWorkers: location.requiredWorkers } })

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
      ? await prisma.job.update({ where: { id: job.id }, data: { servicePlanId: plan.id, servicePlanVersionId: version.id, status: 'active', startDate: scheduledStart, defaultStartMinutes: location.startMinutes, defaultDurationMin: 120, requiredWorkers: location.requiredWorkers } })
      : await prisma.job.create({ data: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, servicePlanId: plan.id, servicePlanVersionId: version.id, name: 'Regular office cleaning', status: 'active', recurrence: { frequency: 'weekly', interval: 1 }, startDate: scheduledStart, defaultStartMinutes: location.startMinutes, defaultDurationMin: 120, requiredWorkers: location.requiredWorkers, instructions: 'Review access notes, complete tasks by area and report shortages before leaving.' } })
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
