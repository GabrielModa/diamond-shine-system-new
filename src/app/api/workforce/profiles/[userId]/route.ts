import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { workforceProfileReady } from '../../../../../modules/workforce/profile-policy'

const inputSchema = z.object({
  employmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  weeklyTargetMinutes: z.number().int().min(60).max(3600),
}).strict()

async function targetForRead(request: NextRequest, userId: string) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth
  const target = await prisma.user.findFirst({
    where: {
      id: userId,
      memberships: { some: { organizationId: auth.user.organizationId } },
    },
    select: { id: true, email: true, name: true, status: true },
  })
  if (!target) return { response: NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 }) }
  return { user: auth.user, target }
}

async function targetForManage(request: NextRequest, userId: string) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth
  const target = await prisma.user.findFirst({
    where: {
      id: userId,
      memberships: { some: { organizationId: auth.user.organizationId } },
    },
    select: { id: true, email: true, name: true, status: true },
  })
  if (!target) return { response: NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 }) }
  return { user: auth.user, target }
}

function serialize(profile: any) {
  if (!profile) return null
  return {
    ...profile,
    homeLatitude: profile.homeLatitude == null ? null : Number(profile.homeLatitude),
    homeLongitude: profile.homeLongitude == null ? null : Number(profile.homeLongitude),
    schoolLatitude: profile.schoolLatitude == null ? null : Number(profile.schoolLatitude),
    schoolLongitude: profile.schoolLongitude == null ? null : Number(profile.schoolLongitude),
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const auth = await targetForRead(request, userId)
  if ('response' in auth) return auth.response
  const profile = await prisma.workforceProfile.findFirst({
    where: { userId, organizationId: auth.user.organizationId },
    include: {
      studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
      recurringUnavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
      leaves: { orderBy: { startsAt: 'asc' } },
    },
  })
  return NextResponse.json({
    ok: true,
    data: {
      user: auth.target,
      profile: serialize(profile),
      setupRequired: !workforceProfileReady(profile),
    },
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const auth = await targetForManage(request, userId)
  if ('response' in auth) return auth.response

  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid employment settings.', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.workforceProfile.findFirst({
    where: { userId, organizationId: auth.user.organizationId },
    include: { studySchedules: true, recurringUnavailability: true, leaves: true },
  })
  if (!existing) {
    return NextResponse.json({
      ok: false,
      error: 'The employee must complete My profile before employment capacity can be configured.',
    }, { status: 409 })
  }

  const profile = await prisma.workforceProfile.update({
    where: { id: existing.id },
    data: {
      employmentStartDate: parsed.data.employmentStartDate
        ? new Date(`${parsed.data.employmentStartDate}T00:00:00.000Z`)
        : null,
      weeklyTargetMinutes: parsed.data.weeklyTargetMinutes,
      weeklyTargetConfigured: true,
    },
    include: { studySchedules: true, recurringUnavailability: true, leaves: true },
  })

  await logAudit(
    auth.user.email,
    'update_workforce_employment_settings',
    'workforce_profile',
    profile.id,
    {
      userId,
      weeklyTargetMinutes: parsed.data.weeklyTargetMinutes,
      employmentStartDate: parsed.data.employmentStartDate,
      employeeOwnedFieldsChanged: false,
    },
    auth.user.organizationId,
  )

  return NextResponse.json({
    ok: true,
    data: {
      user: auth.target,
      profile: serialize(profile),
      setupRequired: !workforceProfileReady(profile),
    },
  })
}
