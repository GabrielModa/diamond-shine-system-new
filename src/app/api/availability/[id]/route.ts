import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const entry = await prisma.availability.findFirst({ where: { id, organizationId: auth.user.organizationId, cancelledAt: null } })
  if (!entry) return NextResponse.json({ ok: false, error: 'Availability entry not found.' }, { status: 404 })
  if (entry.userId !== auth.user.id) {
    const manager = await requireCapability(request, 'schedule.manage')
    if ('response' in manager) return manager.response
  }
  const updated = await prisma.availability.update({ where: { id }, data: { cancelledAt: new Date() } })
  await logAudit(auth.user.email, 'cancel_unavailability', 'availability', id, { userId: entry.userId }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
