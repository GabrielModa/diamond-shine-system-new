import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { incidentUpdateSchema } from '../../../../modules/execution/schemas'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'incidents.manage')
  if ('response' in auth) return auth.response
  const parsed = incidentUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const current = await prisma.incident.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const resolved = parsed.data.status === 'resolved' || parsed.data.status === 'closed'
  const updated = await prisma.incident.update({
    where: { id: current.id },
    data: {
      status: parsed.data.status,
      resolution: parsed.data.resolution,
      resolvedBy: resolved ? auth.user.id : null,
      resolvedAt: resolved ? new Date() : null,
    },
  })
  await logAudit(auth.user.email, 'update_incident', 'incident', current.id, {
    fromStatus: current.status,
    toStatus: updated.status,
    visitId: current.visitId,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}

