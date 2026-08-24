import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../../lib/prisma'
import { requireCapability } from '../../../../../../lib/auth'

// This endpoint intentionally excludes employee names, notes, GPS and internal evidence.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'quality.inspect')
  if ('response' in auth) return auth.response
  const { id } = await context.params
  const inspection = await prisma.qualityInspection.findFirst({
    where: { id, organizationId: auth.user.organizationId, clientVisible: true },
    include: {
      site: { select: { name: true, client: { select: { displayName: true } } } },
      visit: { select: { scheduledStart: true, job: { select: { name: true } } } },
      items: { select: { category: true, title: true, result: true }, orderBy: { sortOrder: 'asc' } },
      actions: { select: { title: true, severity: true, status: true, dueAt: true }, orderBy: { dueAt: 'asc' } },
    },
  })
  if (!inspection) return NextResponse.json({ ok: false, error: 'Client-safe report not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: {
    client: inspection.site.client.displayName,
    site: inspection.site.name,
    service: inspection.visit?.job.name ?? 'Cleaning service',
    serviceDate: inspection.visit?.scheduledStart ?? inspection.inspectedAt,
    inspectedAt: inspection.inspectedAt,
    score: inspection.score,
    grade: inspection.grade,
    passed: inspection.passed,
    summary: inspection.summary,
    completedStandards: inspection.items.filter((item) => item.result === 'pass').map((item) => ({ category: item.category, title: item.title })),
    followUps: inspection.actions.filter((action) => !['verified', 'waived'].includes(action.status)).map((action) => ({ title: action.title.replace(/^Correct:\s*/, ''), severity: action.severity, status: action.status, dueAt: action.dueAt })),
    status: inspection.actions.some((action) => !['verified', 'waived'].includes(action.status)) ? 'follow_up_in_progress' : 'verified_service',
  } })
}
