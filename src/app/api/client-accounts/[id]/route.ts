import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

const TERMINAL_VISIT_STATUSES = ['cancelled', 'missed'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const organizationId = auth.user.organizationId

  const client = await prisma.client.findFirst({
    where: { id, organizationId, archivedAt: null },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      contracts: {
        where: { archivedAt: null },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: { sites: { include: { site: { select: { id: true, name: true } } } } },
      },
      sites: {
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        include: {
          access: true,
          preferredAssignees: {
            orderBy: { priority: 'asc' },
            include: { user: { select: { id: true, name: true, email: true } } },
          },
          servicePlans: {
            where: { archivedAt: null },
            orderBy: { updatedAt: 'desc' },
            include: {
              contract: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
              tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
              versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { id: true, versionNumber: true, publishedAt: true } },
              jobs: {
                where: { archivedAt: null },
                orderBy: { startDate: 'desc' },
                take: 10,
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
  })

  if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 404 })

  const now = new Date()
  const [upcomingVisits, recentVisits] = await Promise.all([
    prisma.visit.findMany({
      where: {
        organizationId,
        site: { clientId: client.id },
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
      where: { organizationId, site: { clientId: client.id }, status: 'completed' },
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

  return NextResponse.json({ ok: true, data: { client, upcomingVisits, recentVisits } })
}
