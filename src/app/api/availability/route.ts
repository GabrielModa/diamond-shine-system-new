import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { availabilityCreateSchema, availabilityQuerySchema } from '../../../modules/scheduling/schemas'
import { workforceConstraintWindows } from '../../../modules/scheduling/workforce-constraints'
import { classifyAvailabilityNotice } from '../../../modules/workforce/profile-policy'

async function hasScheduleManagement(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  return !('response' in auth)
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = availabilityQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const manager = await hasScheduleManagement(request)
  const requestedUserId = parsed.data.userId
  if (requestedUserId && requestedUserId !== auth.user.id && !manager) {
    return NextResponse.json({ ok: false, error: 'Not allowed to view this availability.' }, { status: 403 })
  }
  const from = parsed.data.from ?? new Date(Date.now() - 7 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 90 * 86_400_000)
  if (to <= from) return NextResponse.json({ ok: false, error: 'Availability range must end after it starts.' }, { status: 400 })

  const entries = await prisma.availability.findMany({
    where: {
      organizationId: auth.user.organizationId,
      cancelledAt: null,
      ...(manager && !requestedUserId ? {} : { userId: requestedUserId ?? auth.user.id }),
      startsAt: { lt: to },
      endsAt: { gt: from },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { startsAt: 'asc' },
  })

  // The manager Schedule view asks for all team availability. In that context,
  // return derived workforce blockers as normal unavailable windows too, so the
  // Capacity Finder and visit editor consume the exact server-side school,
  // leave and recurring-unavailability rules instead of duplicating them in React.
  if (manager && !requestedUserId) {
    const [organization, memberships] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: auth.user.organizationId },
        select: { timezone: true },
      }),
      prisma.membership.findMany({
        where: {
          organizationId: auth.user.organizationId,
          status: 'active',
          role: { in: ['employee', 'field_supervisor'] },
          user: {
            status: 'active',
            workforceProfile: { is: { weeklyTargetConfigured: true } },
          },
        },
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
      }),
    ])
    const timezone = organization?.timezone ?? 'Europe/Dublin'
    const derived = memberships.flatMap((membership) => {
      const profile = membership.user.workforceProfile
      if (!profile) return []
      const windows = workforceConstraintWindows({
        studySchedules: profile.studySchedules,
        recurringUnavailability: profile.recurringUnavailability,
        leaves: profile.leaves.map((leave) => ({
          kind: leave.kind as 'school_holiday' | 'personal_leave',
          startsAt: leave.startsAt,
          endsAt: leave.endsAt,
          reason: leave.reason,
        })),
      }, from, to, timezone)
      return windows.map((window, index) => ({
        id: `workforce:${membership.user.id}:${window.kind}:${window.startsAt.toISOString()}:${index}`,
        organizationId: auth.user.organizationId,
        userId: membership.user.id,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        reason: window.reason,
        createdAt: window.startsAt,
        updatedAt: window.startsAt,
        cancelledAt: null,
        user: {
          id: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
        },
        source: 'workforce_constraint' as const,
        constraintKind: window.kind,
      }))
    })

    return NextResponse.json({
      ok: true,
      data: [...entries, ...derived].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()),
    })
  }

  return NextResponse.json({ ok: true, data: entries })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = availabilityCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid availability', details: parsed.error.flatten() }, { status: 400 })
  }

  const userId = parsed.data.userId ?? auth.user.id
  if (userId !== auth.user.id && !(await hasScheduleManagement(request))) {
    return NextResponse.json({ ok: false, error: 'Not allowed to set availability for this person.' }, { status: 403 })
  }

  const member = await prisma.membership.findFirst({
    where: { organizationId: auth.user.organizationId, userId, status: 'active' },
    select: { id: true, user: { select: { name: true, email: true } } },
  })
  if (!member) {
    return NextResponse.json({ ok: false, error: 'Active team member not found.' }, { status: 404 })
  }

  const noticeLevel = classifyAvailabilityNotice(parsed.data.startsAt)
  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.availability.create({
      data: {
        organizationId: auth.user.organizationId,
        userId,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        reason: parsed.data.reason,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    })

    const affectedAssignments = await tx.visitAssignment.count({
      where: {
        organizationId: auth.user.organizationId,
        userId,
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        visit: {
          status: { notIn: ['cancelled', 'completed', 'missed'] },
          scheduledStart: { lt: parsed.data.endsAt },
          scheduledEnd: { gt: parsed.data.startsAt },
        },
      },
    })

    let managementNotified = false
    const shouldNotifyManagement =
      userId === auth.user.id && (noticeLevel !== 'planned' || affectedAssignments > 0)

    if (shouldNotifyManagement) {
      const managers = await tx.membership.findMany({
        where: {
          organizationId: auth.user.organizationId,
          status: 'active',
          role: { in: ['organization_admin', 'field_supervisor', 'scheduler'] },
          userId: { not: userId },
        },
        select: { userId: true },
      })

      if (managers.length) {
        const title = noticeLevel === 'urgent'
          ? 'Urgent availability change'
          : noticeLevel === 'late'
            ? 'Late availability notice'
            : 'Availability conflicts with assignments'
        const priority = noticeLevel === 'urgent' ? 'critical' : noticeLevel === 'late' ? 'high' : 'normal'
        await tx.operationalNotice.create({
          data: {
            organizationId: auth.user.organizationId,
            type: 'schedule_change',
            priority,
            title,
            body: `${member.user.name ?? member.user.email} declared unavailability from ${entry.startsAt.toISOString()} to ${entry.endsAt.toISOString()}. ${affectedAssignments} existing assignment(s) overlap and require review. No visit was cancelled automatically.`,
            requiresAcknowledgement: false,
            createdById: auth.user.id,
            recipients: {
              create: managers.map(({ userId: managerId }) => ({
                organizationId: auth.user.organizationId,
                userId: managerId,
              })),
            },
          },
        })
        managementNotified = true
      }
    }

    return { entry, affectedAssignments, managementNotified }
  })

  await logAudit(
    auth.user.email,
    'declare_unavailability',
    'availability',
    result.entry.id,
    {
      userId,
      startsAt: result.entry.startsAt,
      endsAt: result.entry.endsAt,
      noticeLevel,
      affectedAssignments: result.affectedAssignments,
      managementNotified: result.managementNotified,
    }, auth.user.organizationId,
  )

  return NextResponse.json({
    ok: true,
    data: {
      ...result.entry,
      noticeLevel,
      affectedAssignments: result.affectedAssignments,
      managementNotified: result.managementNotified,
    },
  }, { status: 201 })
}
