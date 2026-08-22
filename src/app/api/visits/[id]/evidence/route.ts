import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { hasCapability } from '../../../../../lib/permissions'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { evidenceCreateSchema } from '../../../../../modules/execution/schemas'
import { asInputJson } from '../../../../../modules/operations/json'

function canAccessEvidence(user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>) {
  return hasCapability({ role: user.membershipRole, capability: 'visits.execute', grants: user.capabilityGrants })
    || hasCapability({ role: user.membershipRole, capability: 'visits.review', grants: user.capabilityGrants })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!canAccessEvidence(user)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: user.organizationId, ...assignedVisitFilter(user) },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const evidence = await prisma.evidenceAsset.findMany({
    where: { organizationId: user.organizationId, visitId: id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({
    ok: true,
    data: evidence.map((item) => ({ ...item, downloadUrl: `/api/evidence/${item.id}` })),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!canAccessEvidence(user)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  const parsed = evidenceCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: user.organizationId, ...assignedVisitFilter(user) },
    select: { id: true },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (parsed.data.taskResultId) {
    const task = await prisma.visitTaskResult.findFirst({
      where: { id: parsed.data.taskResultId, visitId: id, organizationId: user.organizationId },
      select: { id: true, versionTask: { select: { evidenceVisibility: true } } },
    })
    if (!task) return NextResponse.json({ ok: false, error: 'Task result not found' }, { status: 400 })
    if (parsed.data.visibility === 'client_safe' && task.versionTask.evidenceVisibility !== 'client_safe') {
      return NextResponse.json({ ok: false, error: 'This task evidence is internal only.' }, { status: 400 })
    }
  }
  const evidence = await prisma.evidenceAsset.create({
    data: {
      organizationId: user.organizationId,
      visitId: id,
      taskResultId: parsed.data.taskResultId,
      uploadedBy: user.id,
      kind: parsed.data.kind,
      storageKey: parsed.data.storageKey,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      visibility: parsed.data.visibility,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      capturedAt: parsed.data.capturedAt,
      metadata: asInputJson(parsed.data.metadata),
    },
  })
  await logAudit(user.email, 'add_visit_evidence', 'evidence_asset', evidence.id, {
    visitId: id,
    taskResultId: evidence.taskResultId,
    kind: evidence.kind,
  }, user.organizationId)
  return NextResponse.json({ ok: true, data: evidence }, { status: 201 })
}
