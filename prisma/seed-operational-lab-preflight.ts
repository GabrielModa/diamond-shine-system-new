import { PrismaClient } from '@prisma/client'
import { assertDemoSeedAllowed } from '../src/lib/demo-seed-guard'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'

assertDemoSeedAllowed()
const prisma = new PrismaClient()
const REVIEW_NOTE = 'Operational lab baseline: synthetic historical visit approved.'

async function main() {
  const now = new Date()
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' }, select: { id: true } })

  const elapsed = await prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      scheduledStart: { lt: now },
      status: { notIn: ['cancelled', 'completed', 'missed'] },
      job: { name: { startsWith: 'Scenario ·' } },
    },
    select: { id: true, scheduledEnd: true },
  })
  for (const visit of elapsed) {
    await prisma.visit.update({
      where: { id: visit.id },
      data: {
        status: 'completed',
        completedAt: visit.scheduledEnd < now ? visit.scheduledEnd : now,
      },
    })
  }

  const historical = await prisma.visit.findMany({
    where: {
      organizationId: LEGACY_ORGANIZATION_ID,
      status: 'completed',
      job: { name: { startsWith: 'Scenario ·' } },
    },
    select: { id: true },
  })
  for (const visit of historical) {
    await prisma.visitReview.deleteMany({ where: { visitId: visit.id, note: REVIEW_NOTE } })
    await prisma.visitReview.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        visitId: visit.id,
        decision: 'approved',
        note: REVIEW_NOTE,
        reviewedBy: admin.id,
      },
    })
  }

  console.log(`Operational lab preflight: ${elapsed.length} elapsed scenario visit(s) moved to history; ${historical.length} synthetic historical visit(s) approved.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
