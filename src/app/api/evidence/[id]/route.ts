import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '../../../../lib/auth'
import { readEvidence, safeDownloadName } from '../../../../lib/evidence-storage'
import { hasCapability } from '../../../../lib/permissions'
import { prisma } from '../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../modules/execution/access'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const canExecute = hasCapability({ role: user.membershipRole, capability: 'visits.execute', grants: user.capabilityGrants })
  const canReview = hasCapability({ role: user.membershipRole, capability: 'visits.review', grants: user.capabilityGrants })
  if (!canExecute && !canReview) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const evidence = await prisma.evidenceAsset.findFirst({
    where: {
      id,
      organizationId: user.organizationId,
      visit: { organizationId: user.organizationId, ...assignedVisitFilter(user) },
    },
    select: { storageKey: true, fileName: true, mimeType: true, sizeBytes: true },
  })
  if (!evidence) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  const bytes = await readEvidence(evidence.storageKey).catch(() => null)
  if (!bytes) return NextResponse.json({ ok: false, error: 'Evidence file unavailable' }, { status: 404 })
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `inline; filename="${safeDownloadName(evidence.fileName)}"`,
      'Content-Length': String(evidence.sizeBytes),
      'Content-Type': evidence.mimeType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
