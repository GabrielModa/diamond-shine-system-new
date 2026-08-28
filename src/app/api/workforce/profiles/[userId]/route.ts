import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser, requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { workforceProfileReady } from '../../../../../modules/workforce/profile-policy'

const locationSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  address: z.string().trim().min(3).max(240),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
})
const scheduleSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startsMinute: z.number().int().min(0).max(1439),
  endsMinute: z.number().int().min(1).max(1440),
}).refine((v) => v.endsMinute > v.startsMinute, { message: 'End must be after start.' })
const leaveSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().trim().max(240).nullable().optional(),
}).refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { message: 'End must be after start.' })
const inputSchema = z.object({
  phone: z.string().trim().min(5).max(32).nullable().optional(),
  emergencyContact: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(5).max(32),
  }).nullable().optional(),
  employmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  home: locationSchema,
  school: locationSchema.extend({ name: z.string().trim().min(1).max(120) }).nullable().optional(),
  weeklyTargetMinutes: z.number().int().min(60).max(3600),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
  studySchedule: z.array(scheduleSchema).max(21),
  schoolHolidays: z.array(leaveSchema).max(24),
  personalLeaves: z.array(leaveSchema).max(24),
})

async function targetForRead(request: NextRequest, userId: string) {
  const user = await getAuthUser(request)
  if (!user) return { response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }

  if (user.id !== userId) {
    const manager = await requireCapability(request, 'schedule.manage')
    if ('response' in manager) return manager
  }

  const target = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'active',
      memberships: { some: { organizationId: user.organizationId, status: 'active' } },
    },
    select: { id: true, email: true, name: true },
  })
  if (!target) return { response: NextResponse.json({ ok: false, error: 'Team member not found.' }, { status: 404 }) }
  return { user, target }
}

async function targetForManage(request: NextRequest, userId: string) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth
  const target = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'active',
      memberships: { some: { organizationId: auth.user.organizationId, status: 'active' } },
    },
    select: { id: true, email: true, name: true },
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
    return NextResponse.json({ ok: false, error: 'Invalid workforce profile.', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const school = data.school ?? null
  const anyExistingProfile = await prisma.workforceProfile.findUnique({ where: { userId } })
  if (anyExistingProfile && anyExistingProfile.organizationId !== auth.user.organizationId) {
    return NextResponse.json({ ok: false, error: 'This account already has a workforce profile in another organization.' }, { status: 409 })
  }
  const existing = anyExistingProfile
  const homeChanged = Boolean(existing && existing.homeAddress !== data.home.address)
  const schoolChanged = Boolean(existing && existing.schoolAddress !== school?.address)

  const homeLatitude = data.home.latitude !== undefined
    ? data.home.latitude
    : homeChanged ? null : existing?.homeLatitude ?? null
  const homeLongitude = data.home.longitude !== undefined
    ? data.home.longitude
    : homeChanged ? null : existing?.homeLongitude ?? null
  const schoolLatitude = school
    ? school.latitude !== undefined ? school.latitude : schoolChanged ? null : existing?.schoolLatitude ?? null
    : null
  const schoolLongitude = school
    ? school.longitude !== undefined ? school.longitude : schoolChanged ? null : existing?.schoolLongitude ?? null
    : null

  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.workforceProfile.upsert({
      where: { userId },
      update: {
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.emergencyContact !== undefined ? {
          emergencyContactName: data.emergencyContact?.name ?? null,
          emergencyContactPhone: data.emergencyContact?.phone ?? null,
        } : {}),
        ...(data.employmentStartDate !== undefined ? {
          employmentStartDate: data.employmentStartDate
            ? new Date(`${data.employmentStartDate}T00:00:00.000Z`)
            : null,
        } : {}),
        homeLabel: data.home.label ?? 'Home',
        homeAddress: data.home.address,
        homeLatitude,
        homeLongitude,
        schoolName: school?.name ?? null,
        schoolAddress: school?.address ?? null,
        schoolLatitude,
        schoolLongitude,
        weeklyTargetMinutes: data.weeklyTargetMinutes,
        weeklyTargetConfigured: true,
        travelMode: data.travelMode,
      },
      create: {
        organizationId: auth.user.organizationId,
        userId,
        phone: data.phone ?? null,
        emergencyContactName: data.emergencyContact?.name ?? null,
        emergencyContactPhone: data.emergencyContact?.phone ?? null,
        employmentStartDate: data.employmentStartDate
          ? new Date(`${data.employmentStartDate}T00:00:00.000Z`)
          : null,
        homeLabel: data.home.label ?? 'Home',
        homeAddress: data.home.address,
        homeLatitude: data.home.latitude ?? null,
        homeLongitude: data.home.longitude ?? null,
        schoolName: school?.name ?? null,
        schoolAddress: school?.address ?? null,
        schoolLatitude: school?.latitude ?? null,
        schoolLongitude: school?.longitude ?? null,
        weeklyTargetMinutes: data.weeklyTargetMinutes,
        weeklyTargetConfigured: true,
        travelMode: data.travelMode,
      },
    })

    await tx.studySchedule.deleteMany({ where: { profileId: saved.id } })
    await tx.workforceLeave.deleteMany({ where: { profileId: saved.id } })

    if (school && data.studySchedule.length) {
      await tx.studySchedule.createMany({
        data: data.studySchedule.map((rule) => ({
          organizationId: auth.user.organizationId,
          profileId: saved.id,
          ...rule,
        })),
      })
    }

    const leaves = [
      ...data.schoolHolidays.map((leave) => ({ ...leave, kind: 'school_holiday' })),
      ...data.personalLeaves.map((leave) => ({ ...leave, kind: 'personal_leave' })),
    ]
    if (leaves.length) {
      await tx.workforceLeave.createMany({
        data: leaves.map((leave) => ({
          organizationId: auth.user.organizationId,
          profileId: saved.id,
          kind: leave.kind,
          startsAt: new Date(leave.startsAt),
          endsAt: new Date(leave.endsAt),
          reason: leave.reason ?? null,
        })),
      })
    }

    return tx.workforceProfile.findUniqueOrThrow({
      where: { id: saved.id },
      include: { studySchedules: true, leaves: true },
    })
  })

  await logAudit(
    auth.user.email,
    'update_workforce_profile',
    'workforce_profile',
    profile.id,
    {
      userId,
      managerOwnedFieldsConfirmed: true,
      homeChanged,
      schoolChanged,
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
