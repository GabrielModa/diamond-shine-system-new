/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { getCategoryLabel } from '../src/lib/business-logic'
import { labelToDbCategory } from '../src/lib/mappers'
import { ADMIN_EMAIL, FEEDBACK_EMAIL } from '../src/lib/constants'

const prisma = new PrismaClient()

const TEST_PASSWORD = 'password123'

const USERS = [
  { email: 'admin@ds.ie', role: 'admin', name: 'Gabriel Nunes', status: 'active' },
  { email: 'super@ds.ie', role: 'supervisor', name: 'Sarah Johnson', status: 'active' },
  { email: 'employee@ds.ie', role: 'employee', name: 'Strikerlift', status: 'active' },
  { email: 'viewer@ds.ie', role: 'viewer', name: 'Viewer User', status: 'active' },
] as const

const EMPLOYEES = [
  'Strikerlift',
  'Maria Silva',
  'John Connor',
  'Sarah Johnson',
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

  const supplies = Array.from({ length: 30 }).map((_, index) => {
    const priority = pickWeighted([
      { value: 'urgent' as const, weight: 40 },
      { value: 'normal' as const, weight: 35 },
      { value: 'low' as const, weight: 25 },
    ])
    const status = pickWeighted([
      { value: 'Pending' as const, weight: 50 },
      { value: 'EmailSent' as const, weight: 10 },
      { value: 'Completed' as const, weight: 40 },
    ])
    const createdAt = randomDateWithinDays(90)
    const emailSentAt = status !== 'Pending' ? new Date(createdAt.getTime() + randomInt(1, 48) * 3600 * 1000) : null
    const completedAt =
      status === 'Completed' && emailSentAt
        ? new Date(emailSentAt.getTime() + randomInt(1, 72) * 3600 * 1000)
        : status === 'Completed'
          ? new Date(createdAt.getTime() + randomInt(6, 120) * 3600 * 1000)
          : null

    const notes = Math.random() < 0.45 ? NOTES[index % NOTES.length] : null

    return {
      employeeName: EMPLOYEES[index % EMPLOYEES.length],
      clientLocation: LOCATIONS[index % LOCATIONS.length],
      priority,
      products: JSON.stringify(sampleProducts()),
      notes,
      status,
      submittedBy: USERS[index % USERS.length].email,
      createdAt,
      emailSentAt,
      completedAt,
    }
  })

  await prisma.supplyRequest.createMany({ data: supplies })
}

async function seedFeedback() {
  await prisma.feedbackEntry.deleteMany()

  const ratingValues = [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0]

  const streakEmployees = ['Sarah Johnson', 'Emma Wilson']
  const feedback: Array<{
    employeeName: string
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

  for (let i = 0; i < 25; i += 1) {
    const employee = EMPLOYEES[i % EMPLOYEES.length]
    const isStreak = streakEmployees.includes(employee) && i < 6
    const ratings = Array.from({ length: 4 }).map(() =>
      isStreak ? pickWeighted([{ value: 4.5, weight: 40 }, { value: 5.0, weight: 60 }]) : ratingValues[randomInt(0, ratingValues.length - 1)]
    )
    const overall = Number(((ratings[0] + ratings[1] + ratings[2] + ratings[3]) / 4).toFixed(1))
    const category = labelToDbCategory(getCategoryLabel(overall))

    feedback.push({
      employeeName: employee,
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
