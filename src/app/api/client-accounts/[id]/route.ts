import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

import { clientLifecycle, isManualExtraRecurrence } from '../../../../modules/operations/client-lifecycle'

const TERMINAL_VISIT_STATUSES = ['cancelled', 'missed'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const organizationId = auth.user.organizationId
  const now = new Date()

  const [client, upcomingVisits, recentVisits] = await Promise.all([
    prisma.client.findFirst({
      where: { id, organizationId },
      include: {
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, email: true, phone: true, isPrimary: true },
        },
        contracts: {
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          select: { id: true, status: true, startDate: true, endDate: true, archivedAt: true },
        },
        sites: {
          orderBy: { name: 'asc' },
          include: {
            access: { select: { entryInstructions: true } },
            preferredAssignees: {
              orderBy: { priority: 'asc' },
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            servicePlans: {
              orderBy: { updatedAt: 'desc' },
              include: {
                contract: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
                tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, title: true } },
                versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { id: true, versionNumber: true, publishedAt: true } },
                jobs: {
                  orderBy: { startDate: 'desc' },
                  include: {
                    defaultAssignees: { orderBy: { priority: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } },
                    _count: { select: { visits: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.visit.findMany({
      where: {
        organizationId,
        site: { clientId: id },
        scheduledStart: { gte: now },
        status: { notIn: [...TERMINAL_VISIT_STATUSES] },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 8,
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        requiredWorkers: true,
        site: { select: { id: true, name: true } },
        assignments: { where: { status: { in: ['assigned', 'notified', 'seen', 'acknowledged'] } }, select: { status: true, user: { select: { id: true, name: true, email: true } } } },
      },
    }),
    prisma.visit.findMany({
      where: { organizationId, site: { clientId: id }, status: { in: ['completed', 'cancelled', 'missed'] } },
      orderBy: { scheduledStart: 'desc' },
      take: 8,
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        completedAt: true,
        status: true,
        site: { select: { id: true, name: true } },
      },
    }),
  ])

  if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 })

  const pauses = await prisma.servicePause.findMany({
    where: { organizationId, endsAt: { gt: now }, endedEarlyAt: null, OR: [
      { scope: 'client', clientId: id }, { scope: 'site', site: { clientId: id } },
      { scope: 'job', job: { site: { clientId: id } } },
    ] }, orderBy: { startsAt: 'asc' },
  })
  const archived = Boolean(client.archivedAt)
  const visibleContracts = archived ? client.contracts : client.contracts.filter((contract) => !contract.archivedAt)
  const visibleSites = (archived ? client.sites : client.sites.filter((site) => !site.archivedAt)).map((site) => ({
    ...site,
    servicePlans: (archived ? site.servicePlans : site.servicePlans.filter((plan) => !plan.archivedAt)).map((plan) => ({
      ...plan,
      // Manual extra visits are operational occurrences, not a manager-facing Service.
      jobs: (archived ? plan.jobs : plan.jobs.filter((job) => !job.archivedAt))
        .filter((job) => !isManualExtraRecurrence(job.recurrence)),
    })),
  }))

  const lifecycleSource = { ...client, sites: visibleSites }
  const serviceClient = {
    ...client,
    contracts: visibleContracts,
    sites: visibleSites,
    ...clientLifecycle(lifecycleSource, pauses, now),
    pauses,
  }

  return NextResponse.json({
    ok: true,
    data: {
      client: serviceClient,
      upcomingVisits: archived ? [] : upcomingVisits,
      recentVisits,
    },
  })
}
