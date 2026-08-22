import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../../lib/auth'
import { logAudit } from '../../../../../../lib/audit'
import { prisma } from '../../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../../modules/execution/access'
import { taskResultUpdateSchema } from '../../../../../../modules/execution/schemas'
import { asInputJson } from '../../../../../../modules/operations/json'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const parsed = taskResultUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id, taskId } = await params
  const result = await prisma.visitTaskResult.findFirst({
    where: {
      id: taskId,
      visitId: id,
      organizationId: auth.user.organizationId,
      visit: assignedVisitFilter(auth.user),
    },
    include: { versionTask: true },
  })
  if (!result) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (result.version !== parsed.data.version) {
    return NextResponse.json({ ok: false, error: 'Task changed. Refresh and try again.' }, { status: 409 })
  }
  const updated = await prisma.visitTaskResult.update({
    where: { id: result.id },
    data: {
      status: parsed.data.status,
      response: asInputJson(parsed.data.response),
      note: parsed.data.note,
      completedBy: parsed.data.status === 'pending' ? null : auth.user.id,
      completedAt: parsed.data.status === 'pending' ? null : new Date(),
      version: { increment: 1 },
    },
    include: { versionTask: true, evidence: true },
  })
  await logAudit(auth.user.email, 'update_visit_task', 'visit_task_result', result.id, {
    visitId: id,
    status: updated.status,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
