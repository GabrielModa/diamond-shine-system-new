import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { asInputJson } from '../../../modules/operations/json'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(160),
  requireStartPhoto: z.boolean().default(false),
  requireFinishPhoto: z.boolean().default(false),
  requireSignature: z.boolean().default(false),
  requireProblemPhoto: z.boolean().default(true),
  minimumPhotoCount: z.number().int().min(0).max(100).default(0),
  rules: z.unknown().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'service_plans.read')
  if ('response' in auth) return auth.response
  const policies = await prisma.evidencePolicy.findMany({
    where: { organizationId: auth.user.organizationId, archivedAt: null },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ ok: true, data: policies })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'service_plans.manage')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const created = await prisma.evidencePolicy.create({
    data: {
      organizationId: auth.user.organizationId,
      ...parsed.data,
      rules: asInputJson(parsed.data.rules),
    },
  })
  await logAudit(auth.user.email, 'create_evidence_policy', 'evidence_policy', created.id, {
    name: created.name,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
