import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { buildScheduleHealth } from '../../../modules/scheduling/schedule-health'
import { scopeScheduleHealthToEmployee, scopeScheduleHealthToUnassigned } from '../../../modules/scheduling/schedule-health-scope'
import { ensureScheduleContinuity } from '../../../modules/scheduling/continuity'
import { ACTIVE_ASSIGNMENT_STATUSES, NON_OPERATIONAL_VISIT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  employeeId: z.string().min(1).optional(),
  unassigned: z.enum(['true']).optional(),
})

const ensureSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  jobIds: z.array(z.string().min(1)).max(100).optional(),
})

function managerHealthAllowed(role: string) {
  return role !== 'employee'
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  if (!managerHealthAllowed(auth.user.membershipRole)) {
    return NextResponse.json({ ok: false, error: 'Schedule health is a management view.' }, { status: 403 })
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success || parsed.data.to <= parsed.data.from) {
    return NextResponse.json({ ok: false, error: 'Invalid schedule health range.' }, { status: 400 })
  }
  const data = await buildScheduleHealth({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
  })

  if (parsed.data.unassigned) return NextResponse.json({ ok: true, data: scopeScheduleHealthToUnassigned(data) })
  const employeeId = parsed.data.employeeId
  if (!employeeId) return NextResponse.json({ ok: true, data })

  const employeeVisits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: parsed.data.from, lt: parsed.data.to },
      status: { notIn: [...NON_OPERATIONAL_VISIT_STATUSES] },
      assignments: {
        some: {
          userId: employeeId,
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
      },
    },
    select: {
      id: true,
      assignments: {
        where: {
          userId: employeeId,
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
        select: { status: true },
      },
    },
  })

  const activeVisitIds = employeeVisits.map((visit) => visit.id)
  const pendingAcknowledgementVisitIds = employeeVisits
    .filter((visit) => visit.assignments.some((assignment) => assignment.status !== 'acknowledged'))
    .map((visit) => visit.id)

  return NextResponse.json({
    ok: true,
    data: scopeScheduleHealthToEmployee(data, {
      employeeId,
      activeVisitIds,
      pendingAcknowledgementVisitIds,
    }),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = ensureSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.to <= parsed.data.from) {
    return NextResponse.json({ ok: false, error: 'Invalid continuity request.', details: parsed.success ? undefined : parsed.error.flatten() }, { status: 400 })
  }
  const result = await ensureScheduleContinuity({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
    jobIds: parsed.data.jobIds,
  })
  const health = await buildScheduleHealth({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
  })
  return NextResponse.json({ ok: true, data: { result, health } })
}
