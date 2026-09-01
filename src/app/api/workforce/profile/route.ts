import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { AddressValidationError, geocodeAddress } from '../../../../lib/geocoding'
import { prisma } from '../../../../lib/prisma'
import { workforceProfileReady } from '../../../../modules/workforce/profile-policy'
import { isValidPhoneNumber, normalizePhoneNumber, weeklyWindowError } from '../../../../modules/workforce/profile-validation'

const weeklyWindowSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startsMinute: z.number().int().min(0).max(1439),
  endsMinute: z.number().int().min(1).max(1440),
}).strict()

const recurringWindowSchema = weeklyWindowSchema.extend({
  reason: z.string().trim().max(160).nullable().optional(),
})

const phoneSchema = z.string().trim().min(7).max(32).refine(isValidPhoneNumber, {
  message: 'Enter a valid phone number, for example +353871234567.',
})

const selfProfileSchema = z.object({
  phone: phoneSchema,
  home: z.object({ address: z.string().trim().min(5).max(240) }).strict(),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
  emergencyContact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
  }).strict().nullable(),
  school: z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(240),
  }).strict().nullable(),
  studySchedule: z.array(weeklyWindowSchema).max(35),
  recurringUnavailability: z.array(recurringWindowSchema).max(35),
}).strict().superRefine((value, ctx) => {
  if (!value.school && value.studySchedule.length) {
    ctx.addIssue({ code: 'custom', path: ['studySchedule'], message: 'Add a school location before study hours.' })
  }
  const studyError = weeklyWindowError(value.studySchedule, 'Study hours')
  if (studyError) ctx.addIssue({ code: 'custom', path: ['studySchedule'], message: studyError })
  const recurringError = weeklyWindowError(value.recurringUnavailability, 'Weekly unavailability')
  if (recurringError) ctx.addIssue({ code: 'custom', path: ['recurringUnavailability'], message: recurringError })
})


const contactPatchSchema = z.object({
  section: z.literal('contact'),
  phone: phoneSchema,
  emergencyContact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
  }).strict().nullable(),
}).strict()

const homePatchSchema = z.object({
  section: z.literal('home'),
  home: z.object({ address: z.string().trim().min(5).max(240) }).strict(),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
}).strict()

const schoolPatchSchema = z.object({
  section: z.literal('school'),
  school: z.object({
    name: z.string().trim().min(2).max(120),
    address: z.string().trim().min(5).max(240),
  }).strict().nullable(),
  studySchedule: z.array(weeklyWindowSchema).max(35),
}).strict()

const normalWeekPatchSchema = z.object({
  section: z.literal('normal_week'),
  recurringUnavailability: z.array(recurringWindowSchema).max(35),
}).strict()

const sectionPatchSchema = z.discriminatedUnion('section', [
  contactPatchSchema,
  homePatchSchema,
  schoolPatchSchema,
  normalWeekPatchSchema,
])

type Window = { dayOfWeek: number; startsMinute: number; endsMinute: number }
type RecurringWindow = Window & { reason?: string | null }

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
    school: profile.schoolAddress ? {
      name: profile.schoolName ?? 'School',
      address: profile.schoolAddress,
      latitude: profile.schoolLatitude == null ? null : Number(profile.schoolLatitude),
      longitude: profile.schoolLongitude == null ? null : Number(profile.schoolLongitude),
    } : null,
    studySchedule: profile.studySchedules.map((rule: any) => ({
      dayOfWeek: rule.dayOfWeek,
      startsMinute: rule.startsMinute,
      endsMinute: rule.endsMinute,
    })),
    recurringUnavailability: profile.recurringUnavailability.map((rule: any) => ({
      dayOfWeek: rule.dayOfWeek,
      startsMinute: rule.startsMinute,
      endsMinute: rule.endsMinute,
      reason: rule.reason,
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

function sameWindows(current: Window[], next: Window[]) {
  const normalize = (rules: Window[]) => [...rules]
    .map(({ dayOfWeek, startsMinute, endsMinute }) => ({ dayOfWeek, startsMinute, endsMinute }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startsMinute - b.startsMinute || a.endsMinute - b.endsMinute)
  return JSON.stringify(normalize(current)) === JSON.stringify(normalize(next))
}

function sameRecurring(current: RecurringWindow[], next: RecurringWindow[]) {
  const normalize = (rules: RecurringWindow[]) => [...rules]
    .map(({ dayOfWeek, startsMinute, endsMinute, reason }) => ({
      dayOfWeek, startsMinute, endsMinute, reason: reason?.trim() || null,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startsMinute - b.startsMinute || a.endsMinute - b.endsMinute || String(a.reason).localeCompare(String(b.reason)))
  return JSON.stringify(normalize(current)) === JSON.stringify(normalize(next))
}


async function notifyManagers(tx: any, current: NonNullable<Awaited<ReturnType<typeof currentUser>>>, title: string, body: string, priority: 'normal' | 'high' = 'normal') {
  if (!current || current.auth.membershipRole !== 'employee') return
  const managers = await tx.membership.findMany({
    where: {
      organizationId: current.auth.organizationId,
      status: 'active',
      role: { in: ['organization_admin', 'field_supervisor', 'scheduler'] },
      userId: { not: current.auth.id },
    },
    select: { userId: true, user: { select: { email: true } } },
  })
  if (!managers.length) return
  await tx.operationalNotice.create({
    data: {
      organizationId: current.auth.organizationId,
      type: 'schedule_change',
      priority,
      title,
      body,
      requiresAcknowledgement: false,
      createdById: current.auth.id,
      recipients: {
        create: managers.map(({ userId }: { userId: string }) => ({ organizationId: current.auth.organizationId, userId })),
      },
    },
  })
  const recipients = managers.map((manager: { user: { email: string } }) => manager.user.email)
  await tx.notificationJob.create({
    data: {
      organizationId: current.auth.organizationId,
      kind: 'profile_change_alert',
      status: 'queued',
      nextAttemptAt: new Date(Date.now() + (priority === 'high' ? 0 : 10 * 60_000)),
      createdBy: current.auth.email,
      entityType: 'workforce_profile',
      entityId: current.user.id,
      payload: {
        to: recipients,
        employeeName: current.user.name ?? current.user.email,
        changes: [title],
        summary: body,
      },
    },
  })
}

export async function GET(request: NextRequest) {
  const current = await currentUser(request)
  if (!current) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.workforceProfile.findFirst({
    where: { organizationId: current.auth.organizationId, userId: current.auth.id },
    include: {
      studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
      recurringUnavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
    },
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


export async function PATCH(request: NextRequest) {
  const current = await currentUser(request)
  if (!current) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = sectionPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Check the details in this section.', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.workforceProfile.findFirst({
    where: { organizationId: current.auth.organizationId, userId: current.auth.id },
    include: { studySchedules: true, recurringUnavailability: true },
  })
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'Complete your first profile setup before editing individual sections.' }, { status: 409 })
  }

  const data = parsed.data
  if (data.section === 'school') {
    if (!data.school && data.studySchedule.length) {
      return NextResponse.json({ ok: false, error: 'Add a school location before study hours.' }, { status: 400 })
    }
    const error = weeklyWindowError(data.studySchedule, 'Study hours')
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 })
  }
  if (data.section === 'normal_week') {
    const error = weeklyWindowError(data.recurringUnavailability, 'Weekly unavailability')
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 })
  }

  let changedFields: string[] = []
  let notice: { title: string; body: string; priority?: 'normal' | 'high' } | null = null
  let geocoded = false

  try {
    await prisma.$transaction(async (tx) => {
      if (data.section === 'contact') {
        const emergencyPhone = data.emergencyContact ? normalizePhoneNumber(data.emergencyContact.phone) : null
        await tx.workforceProfile.update({
          where: { id: existing.id },
          data: {
            phone: normalizePhoneNumber(data.phone),
            emergencyContactName: data.emergencyContact?.name ?? null,
            emergencyContactPhone: emergencyPhone,
          },
        })
        changedFields = ['phone', 'emergencyContact']
      }

      if (data.section === 'home') {
        const geo = await geocodeAddress(data.home.address)
        geocoded = true
        const changed = existing.homeAddress !== geo.formattedAddress || existing.travelMode !== data.travelMode
        await tx.workforceProfile.update({
          where: { id: existing.id },
          data: {
            homeLabel: 'Home',
            homeAddress: geo.formattedAddress,
            homeLatitude: geo.latitude,
            homeLongitude: geo.longitude,
            travelMode: data.travelMode,
          },
        })
        changedFields = ['home', 'travelMode']
        if (changed) notice = {
          title: 'Operational starting address changed',
          body: `${current.user.name ?? current.user.email} updated their verified home / operational starting address or travel mode. Review future routing where relevant; published visits were not moved automatically.`,
        }
      }

      if (data.section === 'school') {
        const geo = data.school ? await geocodeAddress(`${data.school.name}, ${data.school.address}`) : null
        geocoded = Boolean(geo)
        const changed = (existing.schoolName ?? null) !== (data.school?.name ?? null) ||
          (existing.schoolAddress ?? null) !== (geo?.formattedAddress ?? null) ||
          !sameWindows(existing.studySchedules, data.studySchedule)
        await tx.workforceProfile.update({
          where: { id: existing.id },
          data: {
            schoolName: data.school?.name ?? null,
            schoolAddress: geo?.formattedAddress ?? null,
            schoolLatitude: geo?.latitude ?? null,
            schoolLongitude: geo?.longitude ?? null,
          },
        })
        await tx.studySchedule.deleteMany({ where: { profileId: existing.id } })
        if (data.school && data.studySchedule.length) {
          await tx.studySchedule.createMany({
            data: data.studySchedule.map((rule) => ({ organizationId: current.auth.organizationId, profileId: existing.id, ...rule })),
          })
        }
        changedFields = ['school', 'studySchedule']
        if (changed) notice = {
          title: 'Employee study details changed',
          body: `${current.user.name ?? current.user.email} updated their verified school location or recurring study hours. Review future staffing and routing; published visits were not moved automatically.`,
        }
      }

      if (data.section === 'normal_week') {
        const changed = !sameRecurring(existing.recurringUnavailability, data.recurringUnavailability)
        await tx.recurringUnavailability.deleteMany({ where: { profileId: existing.id } })
        if (data.recurringUnavailability.length) {
          await tx.recurringUnavailability.createMany({
            data: data.recurringUnavailability.map((rule) => ({
              organizationId: current.auth.organizationId,
              profileId: existing.id,
              dayOfWeek: rule.dayOfWeek,
              startsMinute: rule.startsMinute,
              endsMinute: rule.endsMinute,
              reason: rule.reason?.trim() || null,
            })),
          })
        }
        changedFields = ['recurringUnavailability']
        if (changed) notice = {
          title: 'Recurring availability changed',
          body: `${current.user.name ?? current.user.email} changed their normal weekly unavailability. Review future staffing; published visits were not cancelled automatically.`,
          priority: 'high',
        }
      }

      if (notice) await notifyManagers(tx, current, notice.title, notice.body, notice.priority)
    })
  } catch (error) {
    if (error instanceof AddressValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    throw error
  }

  const profile = await prisma.workforceProfile.findUniqueOrThrow({
    where: { id: existing.id },
    include: {
      studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
      recurringUnavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
    },
  })

  await logAudit(
    current.auth.email,
    'update_own_workforce_profile_section',
    'workforce_profile',
    profile.id,
    { section: data.section, changedFields, geocoded },
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

export async function PUT(request: NextRequest) {
  const current = await currentUser(request)
  if (!current) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = selfProfileSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Check the highlighted profile details.', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const anyExistingProfile = await prisma.workforceProfile.findUnique({
    where: { userId: current.auth.id },
    include: { studySchedules: true, recurringUnavailability: true },
  })
  if (anyExistingProfile && anyExistingProfile.organizationId !== current.auth.organizationId) {
    return NextResponse.json({ ok: false, error: 'This account already has a workforce profile in another organization.' }, { status: 409 })
  }

  const existing = anyExistingProfile
  const firstPersonalSetup = !existing
  const requestedHome = data.home.address.trim()
  const requestedSchool = data.school?.address.trim() ?? null
  const homeNeedsValidation = !existing || existing.homeAddress !== requestedHome || existing.homeLatitude == null || existing.homeLongitude == null
  const schoolNeedsValidation = Boolean(data.school && (
    !existing || existing.schoolAddress !== requestedSchool || existing.schoolLatitude == null || existing.schoolLongitude == null
  ))

  let homeGeo: Awaited<ReturnType<typeof geocodeAddress>> | null = null
  let schoolGeo: Awaited<ReturnType<typeof geocodeAddress>> | null = null
  try {
    if (homeNeedsValidation) homeGeo = await geocodeAddress(requestedHome)
    if (data.school && schoolNeedsValidation) schoolGeo = await geocodeAddress(`${data.school.name}, ${data.school.address}`)
  } catch (error) {
    if (error instanceof AddressValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    throw error
  }

  const canonicalHome = homeGeo?.formattedAddress ?? existing?.homeAddress ?? requestedHome
  const canonicalSchool = data.school
    ? schoolGeo?.formattedAddress ?? existing?.schoolAddress ?? data.school.address
    : null
  const addressChanged = Boolean(existing && existing.homeAddress !== canonicalHome)
  const schoolChanged = Boolean(existing && (
    (existing.schoolName ?? null) !== (data.school?.name ?? null) ||
    (existing.schoolAddress ?? null) !== canonicalSchool
  ))
  const studyScheduleChanged = Boolean(existing && !sameWindows(existing.studySchedules, data.studySchedule))
  const recurringChanged = Boolean(existing && !sameRecurring(existing.recurringUnavailability, data.recurringUnavailability))

  const normalizedPhone = normalizePhoneNumber(data.phone)
  const normalizedEmergencyPhone = data.emergencyContact ? normalizePhoneNumber(data.emergencyContact.phone) : null

  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.workforceProfile.upsert({
      where: { userId: current.auth.id },
      update: {
        phone: normalizedPhone,
        homeLabel: 'Home',
        homeAddress: canonicalHome,
        homeLatitude: homeGeo ? homeGeo.latitude : existing?.homeLatitude ?? null,
        homeLongitude: homeGeo ? homeGeo.longitude : existing?.homeLongitude ?? null,
        travelMode: data.travelMode,
        emergencyContactName: data.emergencyContact?.name ?? null,
        emergencyContactPhone: normalizedEmergencyPhone,
        schoolName: data.school?.name ?? null,
        schoolAddress: canonicalSchool,
        schoolLatitude: data.school
          ? schoolGeo ? schoolGeo.latitude : existing?.schoolLatitude ?? null
          : null,
        schoolLongitude: data.school
          ? schoolGeo ? schoolGeo.longitude : existing?.schoolLongitude ?? null
          : null,
      },
      create: {
        organizationId: current.auth.organizationId,
        userId: current.auth.id,
        phone: normalizedPhone,
        homeLabel: 'Home',
        homeAddress: canonicalHome,
        homeLatitude: homeGeo?.latitude ?? null,
        homeLongitude: homeGeo?.longitude ?? null,
        travelMode: data.travelMode,
        emergencyContactName: data.emergencyContact?.name ?? null,
        emergencyContactPhone: normalizedEmergencyPhone,
        schoolName: data.school?.name ?? null,
        schoolAddress: canonicalSchool,
        schoolLatitude: schoolGeo?.latitude ?? null,
        schoolLongitude: schoolGeo?.longitude ?? null,
      },
    })

    await tx.studySchedule.deleteMany({ where: { profileId: saved.id } })
    if (data.school && data.studySchedule.length) {
      await tx.studySchedule.createMany({
        data: data.studySchedule.map((rule) => ({
          organizationId: current.auth.organizationId,
          profileId: saved.id,
          ...rule,
        })),
      })
    }

    await tx.recurringUnavailability.deleteMany({ where: { profileId: saved.id } })
    if (data.recurringUnavailability.length) {
      await tx.recurringUnavailability.createMany({
        data: data.recurringUnavailability.map((rule) => ({
          organizationId: current.auth.organizationId,
          profileId: saved.id,
          dayOfWeek: rule.dayOfWeek,
          startsMinute: rule.startsMinute,
          endsMinute: rule.endsMinute,
          reason: rule.reason?.trim() || null,
        })),
      })
    }

    if (current.auth.membershipRole === 'employee' && (
      firstPersonalSetup || addressChanged || schoolChanged || studyScheduleChanged || recurringChanged
    )) {
      const title = firstPersonalSetup
        ? 'Employee operational profile completed'
        : recurringChanged
          ? 'Recurring availability changed'
          : schoolChanged || studyScheduleChanged
            ? 'Employee study details changed'
            : 'Operational starting address changed'
      const body = firstPersonalSetup
        ? `${current.user.name ?? current.user.email} completed their operational profile. Review company-owned employment setup before automatic scheduling.`
        : recurringChanged
          ? `${current.user.name ?? current.user.email} changed their recurring weekly unavailability. Review future staffing; published visits were not cancelled automatically.`
          : schoolChanged || studyScheduleChanged
            ? `${current.user.name ?? current.user.email} updated school or study hours. Review future staffing and routing; published visits were not moved automatically.`
            : `${current.user.name ?? current.user.email} changed their validated home / operational starting address. Review future routing; published visits were not moved automatically.`

      await notifyManagers(tx, current, title, body, recurringChanged ? 'high' : 'normal')
    }

    return tx.workforceProfile.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
        recurringUnavailability: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] },
      },
    })
  })

  await logAudit(
    current.auth.email,
    'update_own_workforce_profile',
    'workforce_profile',
    profile.id,
    {
      changedFields: ['phone', 'home', 'travelMode', 'emergencyContact', 'school', 'studySchedule', 'recurringUnavailability'],
      addressChanged,
      schoolChanged,
      studyScheduleChanged,
      recurringChanged,
      firstPersonalSetup,
      homeValidated: Boolean(homeGeo),
      schoolValidated: Boolean(schoolGeo),
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
