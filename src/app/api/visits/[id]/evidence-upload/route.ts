import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'

export const runtime = 'nodejs'
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const { id } = await params
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const taskResultId = form?.get('taskResultId')?.toString() || null
  const visibility = form?.get('visibility') === 'client_safe' ? 'client_safe' : 'internal'
  const phase = form?.get('phase')?.toString() || 'task'
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'Upload a JPEG, PNG or WebP image up to 15 MB.' }, { status: 400 })
  }
  const visit = await prisma.visit.findFirst({ where: { id, organizationId: auth.user.organizationId, ...assignedVisitFilter(auth.user) }, select: { id: true } })
  if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found' }, { status: 404 })
  if (taskResultId) {
    const task = await prisma.visitTaskResult.findFirst({ where: { id: taskResultId, visitId: id, organizationId: auth.user.organizationId }, select: { id: true } })
    if (!task) return NextResponse.json({ ok: false, error: 'Checklist item not found' }, { status: 404 })
  }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${extension}`
  const relativeKey = path.posix.join('evidence', auth.user.organizationId, id, fileName)
  const root = path.resolve(process.cwd(), '.data', 'uploads')
  const destination = path.resolve(root, relativeKey)
  if (!destination.startsWith(`${root}${path.sep}`)) return NextResponse.json({ ok: false, error: 'Invalid upload path' }, { status: 400 })
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, Buffer.from(await file.arrayBuffer()))
  const created = await prisma.evidenceAsset.create({
    data: {
      organizationId: auth.user.organizationId,
      visitId: id,
      taskResultId,
      uploadedBy: auth.user.id,
      kind: 'photo',
      storageKey: relativeKey,
      fileName,
      mimeType: file.type,
      sizeBytes: file.size,
      visibility,
      metadata: { phase, source: 'field_mobile' },
    },
  })
  await logAudit(auth.user.email, 'upload_visit_evidence', 'evidence_asset', created.id, { visitId: id, taskResultId, phase, sizeBytes: file.size }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
