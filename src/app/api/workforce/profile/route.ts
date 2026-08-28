import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { workforceProfileReady } from '../../../../modules/workforce/profile-policy'

const selfProfileSchema = z.object({
  phone: z.string().trim().min(5).max(32).nullable(),
  home: z.object({
    address: z.string().trim().min(3).max(240),
  }),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
  emergencyContact: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(5).max(32),
  }).nullable(),
})

function serialize(profile: any) {
  if (!profile) return null
  return {
    phone: profile.phone,
    home: {
      label: profile.homeLabel,
      address: profile.homeAddress,
      latitude: profile.homeLatitude == null ? null : Number(profile.homeLatitude),
      longitude: profile.homeLongitude == null ? null : Number(profile.homeLongitude),
    },
    travelMode: profile.travelMode,
    emergencyContact: profile.emergencyContactName && profile.emergencyContactPhone
      ? { name: profile.emergencyContactName, phone: profile.emergencyContactPhone }
      : null,
    weeklyTargetMinutes: profile.weeklyTargetConfigured ? profile.weeklyTargetMinutes : null,
    employmentStartDate: profile.employmentStartDate,
    school: profile.schoolAddress ? {
      name: profile.schoolName ?? 'School',
      address: profile.schoolAddress,
    } : null,
    studySchedule: profile.studySchedules.map((rule: any) => ({
      dayOfWeek: rule.dayOfWeek,
      startsMinute: rule.startsMinute,
      endsMinute: rule.endsMinute,
    })),
  }
}

async function currentUser(request: NextRequest) {
  const auth = await getAuthUser(request)
  if (!auth) return null
  const user = await prisma.user.findFirst({
    where: {
      id: auth.id,
      status: 'active',
      memberships: { some: { organizationId: auth.organizationId, status: 'active' } },
    },
    select: { id: true, name: true, email: true },
  })
  return user ? { auth, user } : null
}

export async function GET(request: NextRequest) {
  const current = await currentUser(request)
  if (!current) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.workforceProfile.findFirst({
    where: { organizationId: current.auth.organizationId, userId: current.auth.id },
    include: { studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] } },
  })

  return NextResponse.json({
    ok: true,
    data: {
      user: current.user,
      profile: serialize(profile),
      setupRequired: !workforceProfileReady(profile),
      managerSetupRequired: !profile?.weeklyTargetConfigured,
    },
  })
}

export async function PUT(request: NextRequest) {
  const current = await currentUser(request)
  if (!current) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = selfProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid profile.', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const anyExistingProfile = await prisma.workforceProfile.findUnique({ where: { userId: current.auth.id } })
  if (anyExistingProfile && anyExistingProfile.organizationId !== current.auth.organizationId) {
    return NextResponse.json({ ok: false, error: 'This account already has a workforce profile in another organization.' }, { status: 409 })
  }
  const existing = anyExistingProfile
  const addressChanged = Boolean(existing && existing.homeAddress !== data.home.address)
  const firstPersonalSetup = !existing

  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.workforceProfile.upsert({
      where: { userId: current.auth.id },
      update: {
        phone: data.phone,
        homeLabel: 'Home',
        homeAddress: data.home.address,
        homeLatitude: addressChanged ? null : existing?.homeLatitude ?? null,
        homeLongitude: addressChanged ? null : existing?.homeLongitude ?? null,
        travelMode: data.travelMode,
        emergencyContactName: data.emergencyContact?.name ?? null,
        emergencyContactPhone: data.emergencyContact?.phone ?? null,
      },
      create: {
        organizationId: current.auth.organizationId,
        userId: current.auth.id,
        phone: data.phone,
        homeLabel: 'Home',
        homeAddress: data.home.address,
        homeLatitude: null,
        homeLongitude: null,
        travelMode: data.travelMode,
        emergencyContactName: data.emergencyContact?.name ?? null,
        emergencyContactPhone: data.emergencyContact?.phone ?? null,
      },
    })

    if (current.auth.membershipRole === 'employee' && (firstPersonalSetup || addressChanged)) {
      const managers = await tx.membership.findMany({
        where: {
          organizationId: current.auth.organizationId,
          status: 'active',
          role: { in: ['organization_admin', 'field_supervisor', 'scheduler'] },
          userId: { not: current.auth.id },
        },
        select: { userId: true },
      })

      if (managers.length) {
        await tx.operationalNotice.create({
          data: {
            organizationId: current.auth.organizationId,
            type: 'schedule_change',
            priority: 'normal',
            title: firstPersonalSetup ? 'Employee profile needs manager setup' : 'Operational starting address changed',
            body: firstPersonalSetup
              ? `${current.user.name ?? current.user.email} completed their personal workforce profile. Confirm weekly target, start date and any recurring study rules before automatic scheduling.`
              : `${current.user.name ?? current.user.email} changed their operational starting address. Review future routing where relevant; published visits were not moved automatically.`,
            requiresAcknowledgement: false,
            createdById: current.auth.id,
            recipients: {
              create: managers.map(({ userId }) => ({
                organizationId: current.auth.organizationId,
                userId,
              })),
            },
          },
        })
      }
    }

    return tx.workforceProfile.findUniqueOrThrow({
      where: { id: saved.id },
      include: { studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] } },
    })
  })

  await logAudit(
    current.auth.email,
    'update_own_workforce_profile',
    'workforce_profile',
    profile.id,
    {
      changedFields: ['phone', 'home', 'travelMode', 'emergencyContact'],
      addressChanged,
      firstPersonalSetup,
    },
    current.auth.organizationId,
  )

  return NextResponse.json({
    ok: true,
    data: {
      user: current.user,
      profile: serialize(profile),
      setupRequired: !workforceProfileReady(profile),
      managerSetupRequired: !profile.weeklyTargetConfigured,
    },
  })
}
