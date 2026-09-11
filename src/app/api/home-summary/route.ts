import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, getAuthUser } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'

const OPEN_SUPPLY = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit'] as const
const ACTIVE_ASSIGNMENT = ['assigned', 'notified', 'seen', 'acknowledged'] as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const to = new Date(now.getTime() + 7 * 86_400_000)
  const canSchedule = authUserHasCapability(user, 'schedule.read')
  const canSupplies = authUserHasCapability(user, 'supplies.request')

  const [nextVisit, awaitingAcknowledgement, openRequests] = await Promise.all([
    canSchedule ? prisma.visit.findFirst({
      where: {
        organizationId: user.organizationId,
        scheduledStart: { gte: now, lt: to },
        status: { notIn: ['cancelled', 'missed', 'completed'] },
        assignments: {
          some: {
            userId: user.id,
            status: { in: [...ACTIVE_ASSIGNMENT] },
          },
        },
      },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        site: {
          select: {
            name: true,
            client: { select: { displayName: true } },
          },
        },
      },
    }) : Promise.resolve(null),
    prisma.operationalNoticeRecipient.count({
      where: {
        organizationId: user.organizationId,
        userId: user.id,
        acknowledgedAt: null,
        notice: { requiresAcknowledgement: true },
      },
    }),
    canSupplies ? prisma.supplyRequest.count({
      where: {
        organizationId: user.organizationId,
        submittedBy: user.email,
        status: { in: [...OPEN_SUPPLY] },
      },
    }) : Promise.resolve(0),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      nextVisit,
      awaitingAcknowledgement,
      openRequests,
    },
  })
}
