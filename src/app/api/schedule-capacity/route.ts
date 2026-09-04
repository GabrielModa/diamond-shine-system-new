import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { workforceConstraintForWindow } from '../../../modules/scheduling/workforce-constraints'

const windowSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
}).refine((value) => value.end > value.start, { message: 'Window end must be after start.' })

const requestSchema = z.object({
  windows: z.array(windowSchema).min(1).max(12),
  userIds: z.array(z.string().min(1)).max(100).optional(),
})

type BlockKind = 'booked' | 'temporary_unavailability' | 'personal_leave' | 'recurring_unavailability' | 'school'

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid capacity request.', details: parsed.error.flatten() }, { status: 400 })
  }

  const requestedIds = parsed.data.userIds?.length ? [...new Set(parsed.data.userIds)] : null
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: auth.user.organizationId,
      status: 'active',
      role: { in: ['employee', 'field_supervisor'] },
      ...(requestedIds ? { userId: { in: requestedIds } } : {}),
      user: {
        status: 'active',
        workforceProfile: { is: { weeklyTargetConfigured: true } },
      },
    },
    orderBy: { user: { name: 'asc' } },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          workforceProfile: {
            include: {
              studySchedules: true,
              recurringUnavailability: true,
              leaves: true,
            },
          },
        },
      },
    },
  })

  if (requestedIds && memberships.length !== requestedIds.length) {
    return NextResponse.json({
      ok: false,
      error: 'One or more selected people are not configured as executable schedule staff.',
      code: 'CAPACITY_USER_NOT_EXECUTABLE',
    }, { status: 400 })
  }

  const userIds = memberships.map((membership) => membership.user.id)
  const minStart = new Date(Math.min(...parsed.data.windows.map((window) => window.start.getTime())))
  const maxEnd = new Date(Math.max(...parsed.data.windows.map((window) => window.end.getTime())))
  const organization = await prisma.organization.findUnique({
    where: { id: auth.user.organizationId },
    select: { timezone: true },
  })
  const timezone = organization?.timezone ?? 'Europe/Dublin'

  const [temporaryAvailability, assignments] = userIds.length ? await Promise.all([
    prisma.availability.findMany({
      where: {
        organizationId: auth.user.organizationId,
        userId: { in: userIds },
        cancelledAt: null,
        startsAt: { lt: maxEnd },
        endsAt: { gt: minStart },
      },
      select: { userId: true, startsAt: true, endsAt: true, reason: true },
    }),
    prisma.visitAssignment.findMany({
      where: {
        organizationId: auth.user.organizationId,
        userId: { in: userIds },
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        visit: {
          status: { notIn: ['cancelled', 'completed', 'missed'] },
          scheduledStart: { lt: maxEnd },
          scheduledEnd: { gt: minStart },
        },
      },
      select: {
        userId: true,
        visit: {
          select: {
            id: true,
            scheduledStart: true,
            scheduledEnd: true,
            site: { select: { name: true, client: { select: { displayName: true } } } },
          },
        },
      },
    }),
  ]) : [[], []]

  const windows = parsed.data.windows.map((window) => {
    const blocked = memberships.flatMap((membership) => {
      const user = membership.user
      const booking = assignments.find((assignment) =>
        assignment.userId === user.id
        && assignment.visit.scheduledStart < window.end
        && assignment.visit.scheduledEnd > window.start)
      if (booking) {
        return [{
          userId: user.id,
          user: user.name ?? user.email,
          kind: 'booked' as BlockKind,
          reason: `Already working at ${booking.visit.site.client.displayName} · ${booking.visit.site.name}`,
          startsAt: booking.visit.scheduledStart,
          endsAt: booking.visit.scheduledEnd,
          visitId: booking.visit.id,
        }]
      }

      const temporary = temporaryAvailability.find((entry) =>
        entry.userId === user.id && entry.startsAt < window.end && entry.endsAt > window.start)
      if (temporary) {
        return [{
          userId: user.id,
          user: user.name ?? user.email,
          kind: 'temporary_unavailability' as BlockKind,
          reason: temporary.reason?.trim() || 'Temporary unavailability',
          startsAt: temporary.startsAt,
          endsAt: temporary.endsAt,
        }]
      }

      const profile = user.workforceProfile
      const workforce = workforceConstraintForWindow(profile ? {
        studySchedules: profile.studySchedules,
        recurringUnavailability: profile.recurringUnavailability,
        leaves: profile.leaves.map((leave) => ({
          kind: leave.kind as 'school_holiday' | 'personal_leave',
          startsAt: leave.startsAt,
          endsAt: leave.endsAt,
          reason: leave.reason,
        })),
      } : null, window.start, window.end, timezone)
      if (!workforce) return []
      return [{
        userId: user.id,
        user: user.name ?? user.email,
        kind: workforce.kind as BlockKind,
        reason: workforce.reason,
        startsAt: workforce.startsAt,
        endsAt: workforce.endsAt,
      }]
    })

    const blockedBy = blocked.reduce<Record<BlockKind, number>>((counts, item) => {
      counts[item.kind] += 1
      return counts
    }, {
      booked: 0,
      temporary_unavailability: 0,
      personal_leave: 0,
      recurring_unavailability: 0,
      school: 0,
    })

    return {
      start: window.start,
      end: window.end,
      total: memberships.length,
      available: Math.max(0, memberships.length - blocked.length),
      blockedCount: blocked.length,
      blockedBy,
      blocked,
    }
  })

  return NextResponse.json({ ok: true, data: { timezone, windows } })
}
