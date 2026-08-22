import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { visitUpdateSchema } from '../../../../modules/scheduling/schemas'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: auth.user.organizationId, ...(auth.user.membershipRole === 'employee' ? { assignments: { some: { userId: auth.user.id, status: { not: 'removed' } } } } : {}) },
    include: { site: { include: { client: true, access: true, areas: true } }, job: true, servicePlanVersion: { include: { tasks: { orderBy: { sortOrder: 'asc' } } } }, assignments: { include: { user: { select: { id: true, name: true, email: true } } } } },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: visit })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = visitUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const current = await prisma.visit.findFirst({ where: { id, organizationId: auth.user.organizationId }, include: { assignments: true } })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.version !== parsed.data.version) return NextResponse.json({ ok: false, error: 'Visit changed. Refresh and try again.' }, { status: 409 })
  const start = parsed.data.scheduledStart ?? current.scheduledStart
  const end = parsed.data.scheduledEnd ?? current.scheduledEnd
  if (end <= start) return NextResponse.json({ ok: false, error: 'Visit end must be after start.' }, { status: 400 })
  const assigneeIds = parsed.data.assigneeIds ? [...new Set(parsed.data.assigneeIds)] : current.assignments.filter((item) => item.status !== 'removed').map((item) => item.userId)
  if (assigneeIds.length) {
    const [members, conflicts] = await Promise.all([
      prisma.membership.count({ where: { organizationId: auth.user.organizationId, userId: { in: assigneeIds }, status: 'active' } }),
      prisma.visitAssignment.findMany({ where: { organizationId: auth.user.organizationId, userId: { in: assigneeIds }, status: { not: 'removed' }, visit: { id: { not: id }, status: { notIn: ['cancelled', 'completed', 'missed'] }, scheduledStart: { lt: end }, scheduledEnd: { gt: start } } }, include: { user: { select: { name: true, email: true } }, visit: { select: { id: true, scheduledStart: true, scheduledEnd: true } } } }),
    ])
    if (members !== assigneeIds.length) return NextResponse.json({ ok: false, error: 'Every assignee must be an active organization member.' }, { status: 400 })
    if (conflicts.length) return NextResponse.json({ ok: false, error: 'Scheduling conflict', code: 'ASSIGNEE_OVERLAP', data: conflicts }, { status: 409 })
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.assigneeIds) {
      await tx.visitAssignment.deleteMany({ where: { visitId: id } })
      if (assigneeIds.length) await tx.visitAssignment.createMany({ data: assigneeIds.map((userId) => ({ organizationId: auth.user.organizationId, visitId: id, userId })) })
    }
    return tx.visit.update({ where: { id }, data: {
      scheduledStart: parsed.data.scheduledStart, scheduledEnd: parsed.data.scheduledEnd, dispatchNotes: parsed.data.dispatchNotes,
      status: parsed.data.status, cancellationReason: parsed.data.cancellationReason,
      cancelledAt: parsed.data.status === 'cancelled' ? new Date() : undefined, version: { increment: 1 },
    }, include: { assignments: { include: { user: { select: { id: true, name: true, email: true } } } } } })
  })
  await logAudit(auth.user.email, 'update_visit', 'visit', id, { status: updated.status, scheduledStart: updated.scheduledStart }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
