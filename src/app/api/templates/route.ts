import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'

const bodySchema = z.object({
  key: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
})

const DEFAULT_TEMPLATES = [
  {
    key: 'client_supplies',
    subject: 'Diamond Shine Supplies: {{priority}} - {{employee}}',
    body: '<p>Hello,</p><p>Your supplies request is being processed.</p>',
  },
]

export async function GET(request: NextRequest) {
  console.log('[API /api/templates GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const existing = await prisma.emailTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  if (existing.length === 0) {
    await prisma.emailTemplate.createMany({ data: DEFAULT_TEMPLATES })
  }
  const templates = await prisma.emailTemplate.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ ok: true, data: templates })
}

export async function PUT(request: NextRequest) {
  console.log('[API /api/templates PUT]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const updated = await prisma.emailTemplate.upsert({
    where: { key: parsed.data.key },
    update: { subject: parsed.data.subject, body: parsed.data.body },
    create: { key: parsed.data.key, subject: parsed.data.subject, body: parsed.data.body },
  })

  await logAudit(auth.user.email, 'update_template', 'template', updated.id, { key: updated.key })

  return NextResponse.json({ ok: true, data: updated })
}
