import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'

const safeHtml = z.string().min(1).refine(
  (value) => !/<script\b|javascript:|\son[a-z]+\s*=/i.test(value),
  'Unsafe HTML is not allowed'
)

const bodySchema = z.object({
  key: z.string().min(1),
  subject: z.string().min(1),
  body: safeHtml,
})

const DEFAULT_TEMPLATES = [
  {
    key: 'client_supplies',
    subject: 'Diamond Shine Supplies: {{priority}} - {{employee}}',
    body: '<p>Hello,</p><p>Your supplies request is being processed.</p>',
  },
  {
    key: 'user_invite',
    subject: 'You are invited to Diamond Shine',
    body: '<!doctype html><html lang="en"><body style="margin:0;background:#f5f7fb;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e5e7f0;border-radius:18px;overflow:hidden"><div style="padding:28px 32px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff"><strong style="font-size:20px">💎 Diamond Shine</strong><div style="margin-top:6px;opacity:.9">Operations Suite</div></div><div style="padding:32px"><p style="margin:0 0 8px;color:#667085">Welcome to the team</p><h1 style="margin:0 0 18px;font-size:28px">You are invited, {{name}}</h1><p style="font-size:16px;line-height:1.6">Your Diamond Shine workspace is ready. Set your password to securely finish your account setup.</p><p style="margin:28px 0"><a href="{{inviteUrl}}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#6652d8;color:#fff;text-decoration:none;font-weight:700">Create your password</a></p><p style="padding:14px 16px;border-radius:10px;background:#f6f7fb;color:#667085;font-size:13px;line-height:1.5">This secure link expires in 24 hours and can be used only once.</p></div><div style="padding:18px 32px;background:#fafbfc;border-top:1px solid #edf0f5;color:#98a2b3;font-size:12px">Diamond Shine · Secure account invitation</div></div></body></html>',
  },
  {
    key: 'password_reset',
    subject: 'Reset your Diamond Shine password',
    body: '<p>Hello {{name}},</p><p><a href="{{resetUrl}}">Reset your password</a>. This secure link expires in 24 hours and can only be used once.</p><p>If you did not request this, you can ignore this email.</p>',
  },
]

export async function GET(request: NextRequest) {
  console.log('[API /api/templates GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  await prisma.emailTemplate.createMany({
    data: DEFAULT_TEMPLATES.map((template) => ({
      ...template,
      organizationId: auth.user.organizationId,
    })),
    skipDuplicates: true,
  })
  const templates = await prisma.emailTemplate.findMany({
    where: { organizationId: auth.user.organizationId },
    orderBy: { createdAt: 'desc' },
  })
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
    where: {
      organizationId_key: {
        organizationId: auth.user.organizationId,
        key: parsed.data.key,
      },
    },
    update: { subject: parsed.data.subject, body: parsed.data.body },
    create: {
      organizationId: auth.user.organizationId,
      key: parsed.data.key,
      subject: parsed.data.subject,
      body: parsed.data.body,
    },
  })

  await logAudit(
    auth.user.email,
    'update_template',
    'template',
    updated.id,
    { key: updated.key },
    auth.user.organizationId
  )

  return NextResponse.json({ ok: true, data: updated })
}
