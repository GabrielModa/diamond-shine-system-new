import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { hasCapability } from '../../../../../lib/permissions'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { incidentCreateSchema } from '../../../../../modules/execution/schemas'

function canAccessIncidents(user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>) {
  return hasCapability({ role: user.membershipRole, capability: 'visits.execute', grants: user.capabilityGrants })
    || hasCapability({ role: user.membershipRole, capability: 'incidents.manage', grants: user.capabilityGrants })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!canAccessIncidents(user)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: user.organizationId, ...assignedVisitFilter(user) },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const incidents = await prisma.incident.findMany({
    where: { organizationId: user.organizationId, visitId: id },
    include: { reporter: { select: { id: true, name: true, email: true } } },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json({ ok: true, data: incidents })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!canAccessIncidents(user)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  const parsed = incidentCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: user.organizationId, ...assignedVisitFilter(user) },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const incident = await prisma.incident.create({
    data: {
      organizationId: user.organizationId,
      visitId: id,
      reportedBy: user.id,
      category: parsed.data.category,
      severity: parsed.data.severity,
      title: parsed.data.title,
      description: parsed.data.description,
    },
  })
  await logAudit(user.email, 'report_incident', 'incident', incident.id, {
    visitId: id,
    category: incident.category,
    severity: incident.severity,
  }, user.organizationId)
  return NextResponse.json({ ok: true, data: incident }, { status: 201 })
}

