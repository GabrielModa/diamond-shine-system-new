import { prisma } from '../../src/lib/prisma'
import bcrypt from 'bcryptjs'
import { createSessionToken } from '../../src/lib/session'
import {
  LEGACY_ORGANIZATION_ID,
  LEGACY_ORGANIZATION_SLUG,
  legacyRoleToMembershipRole,
} from '../../src/lib/tenancy'

export const TEST_PASSWORD = 'password123'

export async function seedUsers() {
  await prisma.notificationJob.deleteMany()
  await prisma.authRateLimit.deleteMany()
  await prisma.authToken.deleteMany()
  await prisma.supplyRequest.deleteMany()
  await prisma.materialStockCountLine.deleteMany()
  await prisma.materialStockCount.deleteMany()
  await prisma.siteStockLevel.deleteMany()
  await prisma.materialCatalogItem.deleteMany()
  await prisma.correctiveAction.deleteMany()
  await prisma.qualityInspectionItem.deleteMany()
  await prisma.qualityInspection.deleteMany()
  await prisma.feedbackEntry.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.capabilityGrant.deleteMany()
  await prisma.membership.deleteMany()
  await prisma.user.deleteMany()
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
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)
  const users = [
    { email: 'admin@ds.ie', role: 'admin' as const, name: 'Admin' },
    { email: 'super@ds.ie', role: 'supervisor' as const, name: 'Supervisor' },
    { email: 'employee@ds.ie', role: 'employee' as const, name: 'Employee' },
    { email: 'viewer@ds.ie', role: 'viewer' as const, name: 'Viewer' },
  ]
  for (const user of users) {
    const savedUser = await prisma.user.create({
      data: { ...user, password: hash, status: 'active' },
    })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: savedUser.id,
        role: legacyRoleToMembershipRole(user.role),
        status: 'active',
      },
    })
  }
}

export async function getAuthCookie(email: string, password = TEST_PASSWORD): Promise<string> {
  void password
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    throw new Error('User not found for test auth cookie')
  }
  return `ds-session=${await createSessionToken(user.email, user.role)}`
}

export async function cleanSupplies() {
  await prisma.notificationJob.deleteMany()
  await prisma.supplyRequest.deleteMany()
  await prisma.materialStockCountLine.deleteMany()
  await prisma.materialStockCount.deleteMany()
  await prisma.siteStockLevel.deleteMany()
  await prisma.materialCatalogItem.deleteMany()
}

export async function cleanFeedback() {
  await prisma.notificationJob.deleteMany()
  await prisma.feedbackEntry.deleteMany()
}

export async function cleanOperations() {
  await prisma.notificationJob.deleteMany()
  await prisma.supplyRequest.deleteMany()
  await prisma.materialStockCountLine.deleteMany()
  await prisma.materialStockCount.deleteMany()
  await prisma.siteStockLevel.deleteMany()
  await prisma.materialCatalogItem.deleteMany()
  await prisma.correctiveAction.deleteMany()
  await prisma.qualityInspectionItem.deleteMany()
  await prisma.qualityInspection.deleteMany()
  await prisma.evidenceAsset.deleteMany()
  await prisma.incident.deleteMany()
  await prisma.locationEvent.deleteMany()
  await prisma.timeEntry.deleteMany()
  await prisma.visitTaskResult.deleteMany()
  await prisma.offlineMutation.deleteMany()
  await prisma.visitAssignment.deleteMany()
  await prisma.visit.deleteMany()
  await prisma.job.deleteMany()
  await prisma.servicePlanVersionTask.deleteMany()
  await prisma.servicePlanVersion.deleteMany()
  await prisma.taskTemplate.deleteMany()
  await prisma.servicePlan.deleteMany()
  await prisma.evidencePolicy.deleteMany()
  await prisma.contractSite.deleteMany()
  await prisma.area.deleteMany()
  await prisma.siteAccess.deleteMany()
  await prisma.site.deleteMany()
  await prisma.contract.deleteMany()
  await prisma.contact.deleteMany()
  await prisma.client.deleteMany()
}
