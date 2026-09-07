import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { BOOKED_VISIT_STATUSES, CONFIRMED_VISIT_STATUSES, COUNTED_VISIT_TIME_STATUSES } from '../../../modules/scheduling/schedule-lifecycle'

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  employeeId: z.string().min(1),
})

function plannedMinutes(rows: Array<{ scheduledStart: Date; scheduledEnd: Date }>) {
  return rows.reduce((sum, visit) => sum + Math.max(0, Math.round((visit.scheduledEnd.getTime() - visit.scheduledStart.getTime()) / 60_000)), 0)
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid schedule summary query' }, { status: 400 })
  const { from, to, employeeId } = parsed.data
  if (to <= from) return NextResponse.json({ ok: false, error: 'To must be after from.' }, { status: 400 })

  const organizationId = auth.user.organizationId
  const member = await prisma.membership.findFirst({
    where: { organizationId, userId: employeeId, status: 'active', user: { status: 'active' } },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!member) return NextResponse.json({ ok: false, error: 'Employee not found in this organization.' }, { status: 404 })

  const assignmentScope = {
    some: { userId: employeeId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
  }
  const [booked, confirmed, doneVisits, worked] = await Promise.all([
    prisma.visit.findMany({
      where: { organizationId, scheduledStart: { gte: from, lt: to }, status: { in: [...BOOKED_VISIT_STATUSES] }, assignments: assignmentScope },
      select: { scheduledStart: true, scheduledEnd: true },
    }),
    prisma.visit.findMany({
      where: { organizationId, scheduledStart: { gte: from, lt: to }, status: { in: [...CONFIRMED_VISIT_STATUSES] }, assignments: assignmentScope },
      select: { scheduledStart: true, scheduledEnd: true },
    }),
    prisma.visit.count({
      where: { organizationId, scheduledStart: { gte: from, lt: to }, status: 'completed', assignments: assignmentScope },
    }),
    prisma.timeEntry.aggregate({
      where: {
        organizationId,
        userId: employeeId,
        kind: 'visit',
        status: { in: [...COUNTED_VISIT_TIME_STATUSES] },
        durationSeconds: { not: null },
        visit: { status: 'completed', scheduledStart: { gte: from, lt: to } },
      },
      _sum: { durationSeconds: true },
    }),
  ])

  return NextResponse.json({ ok: true, data: {
    employee: member.user,
    booked: { visits: booked.length, minutes: plannedMinutes(booked) },
    confirmed: { visits: confirmed.length, minutes: plannedMinutes(confirmed) },
    done: { visits: doneVisits, minutes: Math.round((worked._sum.durationSeconds ?? 0) / 60) },
  } })
}
