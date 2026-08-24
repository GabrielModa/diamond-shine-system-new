import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { timeEntryDisputeCreateSchema } from '../../../../../modules/execution/schemas'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const entry = await prisma.timeEntry.findFirst({ where: { id, organizationId: user.organizationId }, select: { userId: true } })
  if (!entry) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (entry.userId !== user.id) {
    const manager = await requireCapability(request, 'time.team.review')
    if ('response' in manager) return manager.response
  }
  const disputes = await prisma.timeEntryDispute.findMany({
    where: { organizationId: user.organizationId, timeEntryId: id },
    select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ ok: true, data: disputes })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const parsed = timeEntryDisputeCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Explain the correction in at least 8 characters.', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const entry = await prisma.timeEntry.findFirst({ where: { id, organizationId: user.organizationId }, select: { id: true, userId: true, status: true } })
  if (!entry) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (entry.userId !== user.id) return NextResponse.json({ ok: false, error: 'You can only question your own time record.' }, { status: 403 })
  const dispute = await prisma.timeEntryDispute.create({
    data: { organizationId: user.organizationId, timeEntryId: entry.id, userId: user.id, reason: parsed.data.reason },
    select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
  })
  await logAudit(user.email, 'create_time_entry_dispute', 'time_entry_dispute', dispute.id, { timeEntryId: entry.id, timeEntryStatus: entry.status }, user.organizationId)
  return NextResponse.json({ ok: true, data: dispute }, { status: 201 })
}
