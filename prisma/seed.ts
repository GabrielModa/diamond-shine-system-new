import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { calculateSupplyDueAt, getCategoryLabel } from '../src/lib/business-logic'
import { labelToDbCategory } from '../src/lib/mappers'
import { ADMIN_EMAIL, FEEDBACK_EMAIL } from '../src/lib/constants'

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
    await prisma.user.upsert({
      where: { email: user.email },
      update: { password: hash, role: user.role, name: user.name, status: user.status },
      create: { email: user.email, password: hash, role: user.role, name: user.name, status: user.status },
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

async function main() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)
  await seedUsers(hash)
  await seedSupplies()
  await seedFeedback()

  await prisma.notificationSetting.upsert({
    where: { key: 'supply_alerts' },
    update: { recipients: ADMIN_EMAIL },
    create: { key: 'supply_alerts', recipients: ADMIN_EMAIL },
  })
  await prisma.notificationSetting.upsert({
    where: { key: 'feedback_alerts' },
    update: { recipients: FEEDBACK_EMAIL },
    create: { key: 'feedback_alerts', recipients: FEEDBACK_EMAIL },
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
