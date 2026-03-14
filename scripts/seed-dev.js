/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()
const TEST_PASSWORD = 'password123'

async function main() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)

  await prisma.user.upsert({
    where: { email: 'admin@ds.ie' },
    update: { password: hash, role: 'admin', name: 'Admin', status: 'active' },
    create: { email: 'admin@ds.ie', password: hash, role: 'admin', name: 'Admin', status: 'active' },
  })

  await prisma.user.upsert({
    where: { email: 'super@ds.ie' },
    update: { password: hash, role: 'supervisor', name: 'Supervisor', status: 'active' },
    create: { email: 'super@ds.ie', password: hash, role: 'supervisor', name: 'Supervisor', status: 'active' },
  })

  await prisma.user.upsert({
    where: { email: 'employee@ds.ie' },
    update: { password: hash, role: 'employee', name: 'Employee', status: 'active' },
    create: { email: 'employee@ds.ie', password: hash, role: 'employee', name: 'Employee', status: 'active' },
  })

  await prisma.user.upsert({
    where: { email: 'viewer@ds.ie' },
    update: { password: hash, role: 'viewer', name: 'Viewer', status: 'active' },
    create: { email: 'viewer@ds.ie', password: hash, role: 'viewer', name: 'Viewer', status: 'active' },
  })

  console.log('✅ Seed concluído')
  console.log('Logins: admin@ds.ie, super@ds.ie, employee@ds.ie, viewer@ds.ie')
  console.log('Senha: password123')
}

main()
  .catch((error) => {
    console.error('❌ Erro no seed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
