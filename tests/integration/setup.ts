import { prisma } from '../../src/lib/prisma'
import bcrypt from 'bcryptjs'

export const TEST_PASSWORD = 'password123'

export async function seedUsers() {
  await prisma.user.deleteMany()
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)
  await prisma.user.createMany({
    data: [
      { email: 'admin@ds.ie', password: hash, role: 'admin', name: 'Admin', status: 'active' },
      { email: 'super@ds.ie', password: hash, role: 'supervisor', name: 'Supervisor', status: 'active' },
      { email: 'employee@ds.ie', password: hash, role: 'employee', name: 'Employee', status: 'active' },
      { email: 'viewer@ds.ie', password: hash, role: 'viewer', name: 'Viewer', status: 'active' },
    ],
  })
}

export async function getAuthCookie(email: string, password = TEST_PASSWORD): Promise<string> {
  void email
  void password
  return ''
}

export async function cleanSupplies() {
  await prisma.supplyRequest.deleteMany()
}

export async function cleanFeedback() {
  await prisma.feedbackEntry.deleteMany()
}
