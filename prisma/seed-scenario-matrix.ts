import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { Prisma, PrismaClient } from '@prisma/client'
import { DEMO_EMPLOYEE_SCENARIOS, DEMO_SITE_SCENARIOS } from '../src/lib/demo-scenarios'
import { LEGACY_ORGANIZATION_ID, legacyRoleToMembershipRole } from '../src/lib/tenancy'

const prisma = new PrismaClient()
const TEST_PASSWORD = 'password123'
const DAY = 86_400_000

function atDayOffset(offsetDays: number, minutes: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  date.setMinutes(minutes)
  return date
}

async function ensureEmployeeAccounts() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12)
  for (const scenario of DEMO_EMPLOYEE_SCENARIOS) {
    const user = await prisma.user.upsert({
      where: { email: scenario.email },
      update: { name: scenario.name, role: 'employee', status: 'active' },
      create: { email: scenario.email, name: scenario.name, role: 'employee', status: 'active', password: hash },
    })
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: LEGACY_ORGANIZATION_ID, userId: user.id } },
      update: { role: legacyRoleToMembershipRole('employee'), status: 'active' },
      create: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: legacyRoleToMembershipRole('employee'),
        status: 'active',
      },
    })
  }
}

async function seedEmployeeContexts() {
  const now = new Date()
  for (const scenario of DEMO_EMPLOYEE_SCENARIOS) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: scenario.email } })
    const profile = await prisma.workforceProfile.upsert({
      where: { userId: user.id },
      update: {
        homeAddress: scenario.home.address,
        homeLatitude: scenario.home.latitude,
        homeLongitude: scenario.home.longitude,
        schoolName: scenario.school?.name ?? null,
        schoolAddress: scenario.school?.address ?? null,
        schoolLatitude: scenario.school?.latitude ?? null,
        schoolLongitude: scenario.school?.longitude ?? null,
        weeklyTargetMinutes: scenario.weeklyTargetMinutes,
        travelMode: scenario.travelMode,
      },
      create: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        homeAddress: scenario.home.address,
        homeLatitude: scenario.home.latitude,
        homeLongitude: scenario.home.longitude,
        schoolName: scenario.school?.name ?? null,
        schoolAddress: scenario.school?.address ?? null,
        schoolLatitude: scenario.school?.latitude ?? null,
        schoolLongitude: scenario.school?.longitude ?? null,
        weeklyTargetMinutes: scenario.weeklyTargetMinutes,
        travelMode: scenario.travelMode,
      },
    })

    await prisma.studySchedule.deleteMany({ where: { profileId: profile.id } })
    if (scenario.studySchedule.length) {
      await prisma.studySchedule.createMany({
        data: scenario.studySchedule.map((rule) => ({
          organizationId: LEGACY_ORGANIZATION_ID,
          profileId: profile.id,
          ...rule,
        })),
      })
    }

    await prisma.workforceLeave.deleteMany({
      where: { profileId: profile.id, reason: { startsWith: 'Scenario matrix' } },
    })
    if (scenario.leave) {
      await prisma.workforceLeave.create({
        data: {
          organizationId: LEGACY_ORGANIZATION_ID,
          profileId: profile.id,
          kind: scenario.leave,
          startsAt: new Date(now.getTime() - DAY),
          endsAt: new Date(now.getTime() + 5 * DAY),
          reason: `Scenario matrix: ${scenario.leave}`,
        },
      })
    }

    await prisma.timeEntry.deleteMany({
      where: { organizationId: LEGACY_ORGANIZATION_ID, userId: user.id, source: 'scenario-matrix-v6' },
    })
    for (const entry of scenario.workedHours) {
      const startedAt = atDayOffset(-entry.daysAgo, 9 * 60)
      await prisma.timeEntry.create({
        data: {
          organizationId: LEGACY_ORGANIZATION_ID,
          userId: user.id,
          kind: 'general',
          status: 'approved',
          startedAt,
          endedAt: new Date(startedAt.getTime() + entry.hours * 3_600_000),
          durationSeconds: entry.hours * 3600,
          source: 'scenario-matrix-v6',
          clientMutationId: `scenario-v6:${scenario.email}:${startedAt.toISOString().slice(0,10)}`,
        },
      })
    }
  }
}

async function ensureScenarioSite(siteScenario: (typeof DEMO_SITE_SCENARIOS)[number], index: number) {
  const client = await prisma.client.upsert({
    where: { organizationId_externalId: { organizationId: LEGACY_ORGANIZATION_ID, externalId: siteScenario.externalId } },
    update: { displayName: siteScenario.client, status: 'active' },
    create: {
      organizationId: LEGACY_ORGANIZATION_ID,
      externalId: siteScenario.externalId,
      displayName: siteScenario.client,
      billingEmail: `facilities@${siteScenario.externalId.replace('scenario-','')}.example`,
      status: 'active',
    },
  })

  let site = await prisma.site.findFirst({
    where: { organizationId: LEGACY_ORGANIZATION_ID, clientId: client.id, name: siteScenario.site },
  })
  const siteData = {
    addressLine1: siteScenario.addressLine1,
    city: siteScenario.city,
    postalCode: siteScenario.postalCode,
    latitude: siteScenario.latitude,
    longitude: siteScenario.longitude,
    coordinateAccuracyM: 10,
    coordinateSource: 'gps_verified' as const,
    status: 'active' as const,
  }
  site = site
    ? await prisma.site.update({ where: { id: site.id }, data: siteData })
    : await prisma.site.create({
        data: {
          organizationId: LEGACY_ORGANIZATION_ID,
          clientId: client.id,
          name: siteScenario.site,
          ...siteData,
        },
      })

  const contract = await prisma.contract.upsert({
    where: {
      organizationId_reference: {
        organizationId: LEGACY_ORGANIZATION_ID,
        reference: `SCN-${String(index + 1).padStart(3,'0')}-2026`,
      },
    },
    update: { clientId: client.id, name: `${siteScenario.client} scenario agreement`, status: 'active' },
    create: {
      organizationId: LEGACY_ORGANIZATION_ID,
      clientId: client.id,
      name: `${siteScenario.client} scenario agreement`,
      reference: `SCN-${String(index + 1).padStart(3,'0')}-2026`,
      status: 'active',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  })
  await prisma.contractSite.upsert({
    where: { contractId_siteId: { contractId: contract.id, siteId: site.id } },
    update: {},
    create: { contractId: contract.id, siteId: site.id },
  })

  let plan = await prisma.servicePlan.findFirst({
    where: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: 'Scenario cleaning plan' },
  })
  plan = plan
    ? await prisma.servicePlan.update({
        where: { id: plan.id },
        data: {
          contractId: contract.id,
          status: 'published',
          expectedDurationMinutes: siteScenario.durationMinutes,
          requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
        },
      })
    : await prisma.servicePlan.create({
        data: {
          organizationId: LEGACY_ORGANIZATION_ID,
          contractId: contract.id,
          siteId: site.id,
          name: 'Scenario cleaning plan',
          description: `Scenario coverage: ${siteScenario.tags.join(', ')}`,
          status: 'published',
          expectedDurationMinutes: siteScenario.durationMinutes,
          requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
        },
      })

  let task = await prisma.taskTemplate.findFirst({
    where: { servicePlanId: plan.id, title: 'Complete scheduled cleaning service' },
  })
  task = task ?? await prisma.taskTemplate.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      servicePlanId: plan.id,
      title: 'Complete scheduled cleaning service',
      instructions: 'Scenario task used to exercise scheduling and execution flows.',
      responseType: 'done_na_problem',
      critical: false,
      required: true,
      evidenceRequired: false,
      sortOrder: 0,
    },
  })

  const version = await prisma.servicePlanVersion.upsert({
    where: { servicePlanId_versionNumber: { servicePlanId: plan.id, versionNumber: 1 } },
    update: {
      expectedDurationMinutes: siteScenario.durationMinutes,
      requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
      snapshot: { scenario: true, tags: siteScenario.tags },
      contentHash: `scenario-v6-${siteScenario.externalId}`,
      publishedBy: 'admin@ds.ie',
    },
    create: {
      organizationId: LEGACY_ORGANIZATION_ID,
      servicePlanId: plan.id,
      versionNumber: 1,
      expectedDurationMinutes: siteScenario.durationMinutes,
      requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
      snapshot: { scenario: true, tags: siteScenario.tags },
      contentHash: `scenario-v6-${siteScenario.externalId}`,
      publishedBy: 'admin@ds.ie',
    },
  })

  const versionTask = await prisma.servicePlanVersionTask.findFirst({
    where: { versionId: version.id, sourceTaskId: task.id },
  })
  if (!versionTask) {
    await prisma.servicePlanVersionTask.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        versionId: version.id,
        sourceTaskId: task.id,
        sourceAreaId: null,
        areaName: null,
        title: task.title,
        instructions: task.instructions,
        responseType: task.responseType,
        critical: task.critical,
        required: task.required,
        evidenceRequired: task.evidenceRequired,
        evidenceVisibility: task.evidenceVisibility,
        options: task.options === null ? Prisma.JsonNull : task.options as Prisma.InputJsonValue,
        conditionalRules: task.conditionalRules === null ? Prisma.JsonNull : task.conditionalRules as Prisma.InputJsonValue,
        sortOrder: 0,
      },
    })
  }

  return { client, site, contract, plan, version }
}

async function seedScheduleMatrix() {
  for (const [index, siteScenario] of DEMO_SITE_SCENARIOS.entries()) {
    const { site, contract, plan, version } = await ensureScenarioSite(siteScenario, index)

    let job = await prisma.job.findFirst({
      where: { organizationId: LEGACY_ORGANIZATION_ID, siteId: site.id, name: `Scenario · ${siteScenario.site}` },
    })
    const jobData = {
      contractId: contract.id,
      servicePlanId: plan.id,
      servicePlanVersionId: version.id,
      status: 'active' as const,
      startDate: atDayOffset(-7, siteScenario.startMinute),
      endDate: atDayOffset(30, siteScenario.startMinute),
      defaultStartMinutes: siteScenario.startMinute,
      defaultDurationMin: siteScenario.durationMinutes,
      requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
      instructions: `Scenario matrix: ${siteScenario.tags.join(', ')}`,
    }
    job = job
      ? await prisma.job.update({ where: { id: job.id }, data: jobData })
      : await prisma.job.create({
          data: {
            organizationId: LEGACY_ORGANIZATION_ID,
            siteId: site.id,
            name: `Scenario · ${siteScenario.site}`,
            timezone: 'Europe/Dublin',
            ...jobData,
          },
        })

    for (let offset = -5; offset <= 10; offset += 1) {
      if ([0,6].includes(new Date(atDayOffset(offset, 12*60)).getDay())) continue
      const scheduledStart = atDayOffset(offset, siteScenario.startMinute)
      const scheduledEnd = new Date(scheduledStart.getTime() + siteScenario.durationMinutes * 60_000)
      const status = offset < -1 ? 'completed' : offset === -1 ? 'completed' : 'scheduled'
      const visit = await prisma.visit.upsert({
        where: { jobId_generationKey: { jobId: job.id, generationKey: `scenario-v6-${offset}` } },
        update: {
          scheduledStart, scheduledEnd, status,
          completedAt: status === 'completed' ? scheduledEnd : null,
        },
        create: {
          organizationId: LEGACY_ORGANIZATION_ID,
          jobId: job.id,
          siteId: site.id,
          servicePlanVersionId: version.id,
          scheduledStart,
          scheduledEnd,
          timezone: 'Europe/Dublin',
          status,
          sequenceNumber: offset + 100,
          generationKey: `scenario-v6-${offset}`,
          requiredWorkers: Math.min(2, siteScenario.employeeEmails.length),
          completedAt: status === 'completed' ? scheduledEnd : null,
        },
      })

      for (const email of siteScenario.employeeEmails) {
        const user = await prisma.user.findUniqueOrThrow({ where: { email } })
        await prisma.visitAssignment.upsert({
          where: { visitId_userId: { visitId: visit.id, userId: user.id } },
          update: { status: 'assigned' },
          create: {
            organizationId: LEGACY_ORGANIZATION_ID,
            visitId: visit.id,
            userId: user.id,
            status: 'assigned',
          },
        })
      }
    }
  }
}

export async function seedScenarioMatrix() {
  await ensureEmployeeAccounts()
  await seedEmployeeContexts()
  await seedScheduleMatrix()
  console.log(`Scenario matrix ready: ${DEMO_EMPLOYEE_SCENARIOS.length} employees, ${DEMO_SITE_SCENARIOS.length} additional client/site scenarios.`)
}

async function main() {
  await seedScenarioMatrix()
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCli) {
  main()
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
