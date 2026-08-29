import type { Prisma } from '@prisma/client'
import { ACTIVE_ASSIGNMENT_STATUSES } from './assignment-lifecycle'
import { workforceConstraintForWindow } from './workforce-constraints'
import { intervalsOverlap } from './schedule-health-core'

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const

type ClientLike = Prisma.TransactionClient

type Window = { start: Date; end: Date }

type Member = {
  user: {
    id: string
    workforceProfile: null | {
      weeklyTargetConfigured: boolean
      studySchedules: Array<{ dayOfWeek: number; startsMinute: number; endsMinute: number }>
      recurringUnavailability: Array<{ dayOfWeek: number; startsMinute: number; endsMinute: number; reason: string | null }>
      leaves: Array<{ kind: string; startsAt: Date; endsAt: Date; reason: string | null }>
    }
  }
}

export async function buildDefaultTeamAllocator(
  db: ClientLike,
  input: {
    organizationId: string
    userIds: string[]
    from: Date
    to: Date
    timezone: string
  },
) {
  const orderedIds = [...new Set(input.userIds)]
  if (!orderedIds.length) {
    return {
      executableIds: [] as string[],
      select: (_start: Date, _end: Date, _maximum: number) => [] as string[],
    }
  }

  const [memberships, availability, assignments] = await Promise.all([
    db.membership.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: orderedIds },
        status: 'active',
        role: { in: [...EXECUTABLE_ROLES] },
        user: { status: 'active' },
      },
      include: {
        user: {
          select: {
            id: true,
            workforceProfile: { include: { studySchedules: true, recurringUnavailability: true, leaves: true } },
          },
        },
      },
    }),
    db.availability.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: orderedIds },
        cancelledAt: null,
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
      },
      select: { userId: true, startsAt: true, endsAt: true },
    }),
    db.visitAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: orderedIds },
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        visit: {
          status: { notIn: ['cancelled', 'completed', 'missed'] },
          scheduledStart: { lt: input.to },
          scheduledEnd: { gt: input.from },
        },
      },
      select: { userId: true, visit: { select: { scheduledStart: true, scheduledEnd: true } } },
    }),
  ])

  const byUser = new Map((memberships as Member[]).map((membership) => [membership.user.id, membership]))
  const occupied = new Map<string, Window[]>()
  for (const assignment of assignments) {
    const windows = occupied.get(assignment.userId) ?? []
    windows.push({ start: assignment.visit.scheduledStart, end: assignment.visit.scheduledEnd })
    occupied.set(assignment.userId, windows)
  }

  function isFree(userId: string, start: Date, end: Date) {
    const membership = byUser.get(userId)
    if (!membership) return false
    if (availability.some((entry) => entry.userId === userId && intervalsOverlap(start, end, entry.startsAt, entry.endsAt))) return false
    const profile = membership.user.workforceProfile
    if (!profile?.weeklyTargetConfigured) return false
    const workforceConflict = workforceConstraintForWindow({
      studySchedules: profile.studySchedules,
      recurringUnavailability: profile.recurringUnavailability,
      leaves: profile.leaves.map((leave) => ({
        kind: leave.kind as 'school_holiday' | 'personal_leave',
        startsAt: leave.startsAt,
        endsAt: leave.endsAt,
        reason: leave.reason,
      })),
    }, start, end, input.timezone)
    if (workforceConflict) return false
    return !(occupied.get(userId) ?? []).some((window) => intervalsOverlap(start, end, window.start, window.end))
  }

  return {
    executableIds: orderedIds.filter((id) => Boolean(byUser.get(id)?.user.workforceProfile?.weeklyTargetConfigured)),
    select(start: Date, end: Date, maximum: number) {
      const selected: string[] = []
      for (const userId of orderedIds) {
        if (selected.length >= maximum) break
        if (!isFree(userId, start, end)) continue
        selected.push(userId)
        const windows = occupied.get(userId) ?? []
        windows.push({ start, end })
        occupied.set(userId, windows)
      }
      return selected
    },
  }
}
