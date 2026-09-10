import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

const TERMINAL_VISIT_STATUSES = ['cancelled', 'missed'] as const

function isManualExtraRecurrence(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (value as { source?: unknown }).source === 'manual_extra'
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const organizationId = auth.user.organizationId
  const now = new Date()

  const [client, upcomingVisits, recentVisits] = await Promise.all([
    prisma.client.findFirst({
      where: { id, organizationId, archivedAt: null },
      include: {
        contacts: {
          orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, email: true, phone: true, isPrimary: true },
        },
        contracts: {
          where: { archivedAt: null },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          select: { id: true, status: true, startDate: true, endDate: true },
        },
        sites: {
          where: { archivedAt: null },
          orderBy: { name: 'asc' },
          include: {
            access: { select: { entryInstructions: true } },
            preferredAssignees: {
              orderBy: { priority: 'asc' },
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            servicePlans: {
              where: { archivedAt: null },
              orderBy: { updatedAt: 'desc' },
              include: {
                contract: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
                tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, title: true } },
                versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { id: true, versionNumber: true, publishedAt: true } },
                jobs: {
                  where: { archivedAt: null },
                  orderBy: { startDate: 'desc' },
                  take: 25,
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
      where: { organizationId, site: { clientId: id }, status: 'completed' },
      orderBy: { completedAt: 'desc' },
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

  const serviceClient = {
    ...client,
    sites: client.sites.map((site) => ({
      ...site,
      servicePlans: site.servicePlans.map((plan) => ({
        ...plan,
        // Manual extra visits are operational occurrences, not a new service rule.
        jobs: plan.jobs.filter((job) => !isManualExtraRecurrence(job.recurrence)).slice(0, 10),
      })),
    })),
  }

  return NextResponse.json({ ok: true, data: { client: serviceClient, upcomingVisits, recentVisits } })
}
