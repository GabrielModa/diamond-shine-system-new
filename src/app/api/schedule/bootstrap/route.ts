import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUserHasCapability, requireCapability } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((value) => value.to > value.from, { message: 'Invalid schedule range.' })
  .refine((value) => value.to.getTime() - value.from.getTime() <= 120 * 86_400_000, { message: 'Schedule range is too large.' })

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid schedule range.' }, { status: 400 })

  const organizationId = auth.user.organizationId
  const canManage = authUserHasCapability(auth.user, 'schedule.manage')
  const ownOnly = auth.user.membershipRole === 'employee'

  const [visits, plans, memberships, availability] = await Promise.all([
    prisma.visit.findMany({
      where: {
        organizationId,
        scheduledStart: { gte: parsed.data.from, lte: parsed.data.to },
        ...(ownOnly ? {
          assignments: { some: { userId: auth.user.id, status: { in: ['assigned', 'notified', 'seen', 'acknowledged'] } } },
        } : {}),
      },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true,
        scheduledStart: true,
        scheduledEnd: true,
        status: true,
        version: true,
        requiredWorkers: true,
        dispatchNotes: true,
        cancellationReason: true,
        site: {
          select: {
            name: true,
            city: true,
            client: { select: { displayName: true } },
          },
        },
        job: { select: { name: true } },
        assignments: {
          select: {
            status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
    prisma.servicePlan.findMany({
      where: { organizationId, archivedAt: null, status: 'published', site: { archivedAt: null, client: { archivedAt: null } } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        expectedDurationMinutes: true,
        requiredWorkers: true,
        site: {
          select: {
            id: true,
            name: true,
            city: true,
            client: { select: { id: true, displayName: true } },
          },
        },
      },
    }),
    prisma.membership.findMany({
      where: {
        organizationId,
        status: 'active',
        role: { in: ['employee', 'field_supervisor'] },
        user: {
          status: 'active',
          workforceProfile: { is: { weeklyTargetConfigured: true } },
        },
      },
      orderBy: { user: { name: 'asc' } },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.availability.findMany({
      where: {
        organizationId,
        cancelledAt: null,
        ...(!canManage ? { userId: auth.user.id } : {}),
        startsAt: { lt: parsed.data.to },
        endsAt: { gt: parsed.data.from },
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { startsAt: 'asc' },
    }),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      visits,
      plans,
      team: memberships.map((membership) => ({ ...membership.user, role: membership.role })),
      availability,
    },
  })
}
