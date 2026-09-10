import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { AddressValidationError, geocodeAddress } from '../../../../../lib/geocoding'
import { prisma } from '../../../../../lib/prisma'
import { workforceProfileReady } from '../../../../../modules/workforce/profile-policy'
import { weeklyWindowError } from '../../../../../modules/workforce/profile-validation'

const inputSchema = z.object({
  employmentStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  weeklyTargetMinutes: z.number().int().min(60).max(3600),
}).strict()

const weeklyWindowSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startsMinute: z.number().int().min(0).max(1439),
  endsMinute: z.number().int().min(1).max(1440),
}).strict()

const assistedSchedulingSchema = z.object({
  school: z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(240),
  }).strict().nullable(),
  studySchedule: z.array(weeklyWindowSchema).max(35),
  recurringUnavailability: z.array(weeklyWindowSchema.extend({
    reason: z.string().trim().max(160).nullable().optional(),
  })).max(35),
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
  const [profile, temporaryAvailability] = await Promise.all([
    prisma.workforceProfile.findFirst({
      where: { userId, organizationId: auth.user.organizationId },
      include: {
        studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
        recurringUnavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
        leaves: { orderBy: { startsAt: 'asc' } },
      },
    }),
    prisma.availability.findMany({
      where: {
        userId,
        organizationId: auth.user.organizationId,
        cancelledAt: null,
        endsAt: { gt: new Date() },
      },
      select: { id: true, startsAt: true, endsAt: true, reason: true, createdAt: true },
      orderBy: { startsAt: 'asc' },
      take: 20,
    }),
  ])
  return NextResponse.json({
    ok: true,
    data: {
      user: auth.target,
      profile: serialize(profile),
      temporaryAvailability,
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


export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const auth = await targetForManage(request, userId)
  if ('response' in auth) return auth.response

  const parsed = assistedSchedulingSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Check the assisted scheduling details.', details: parsed.error.flatten() }, { status: 400 })
  }
  if (!parsed.data.school && parsed.data.studySchedule.length) {
    return NextResponse.json({ ok: false, error: 'A mapped school is required before study hours can be saved.' }, { status: 400 })
  }
  const studyError = weeklyWindowError(parsed.data.studySchedule, 'Study hours')
  if (studyError) return NextResponse.json({ ok: false, error: studyError }, { status: 400 })
  const recurringError = weeklyWindowError(parsed.data.recurringUnavailability, 'Weekly unavailability')
  if (recurringError) return NextResponse.json({ ok: false, error: recurringError }, { status: 400 })

  const existing = await prisma.workforceProfile.findFirst({
    where: { userId, organizationId: auth.user.organizationId },
    include: { studySchedules: true, recurringUnavailability: true, leaves: true },
  })
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'The employee must complete My profile before an administrator can assist with scheduling details.' }, { status: 409 })
  }

  let mappedSchool: Awaited<ReturnType<typeof geocodeAddress>> | null = null
  if (parsed.data.school) {
    try {
      mappedSchool = await geocodeAddress(parsed.data.school.address)
    } catch (error) {
      if (error instanceof AddressValidationError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
      }
      throw error
    }
  }

  const profile = await prisma.$transaction(async (tx) => {
    await tx.studySchedule.deleteMany({ where: { profileId: existing.id } })
    await tx.recurringUnavailability.deleteMany({ where: { profileId: existing.id } })

    return tx.workforceProfile.update({
      where: { id: existing.id },
      data: {
        schoolName: parsed.data.school?.name ?? null,
        schoolAddress: mappedSchool?.formattedAddress ?? null,
        schoolLatitude: mappedSchool?.latitude ?? null,
        schoolLongitude: mappedSchool?.longitude ?? null,
        studySchedules: parsed.data.studySchedule.length ? {
          create: parsed.data.studySchedule.map((rule) => ({
            organizationId: auth.user.organizationId,
            ...rule,
          })),
        } : undefined,
        recurringUnavailability: parsed.data.recurringUnavailability.length ? {
          create: parsed.data.recurringUnavailability.map((rule) => ({
            organizationId: auth.user.organizationId,
            ...rule,
            reason: rule.reason?.trim() || null,
          })),
        } : undefined,
      },
      include: { studySchedules: true, recurringUnavailability: true, leaves: true },
    })
  })

  await logAudit(
    auth.user.email,
    'admin_assist_workforce_scheduling_profile',
    'workforce_profile',
    profile.id,
    {
      userId,
      schoolChanged: (existing.schoolAddress ?? null) !== (profile.schoolAddress ?? null),
      studyScheduleCount: profile.studySchedules.length,
      recurringUnavailabilityCount: profile.recurringUnavailability.length,
      actorRole: auth.user.membershipRole,
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
