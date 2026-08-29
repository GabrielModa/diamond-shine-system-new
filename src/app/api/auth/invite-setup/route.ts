import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getInviteSetupContext } from '../../../../lib/invite-setup'
import { GooglePlacesError, resolveGooglePlace } from '../../../../lib/google-places'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { createSessionToken, sessionCookie } from '../../../../lib/session'
import { membershipRoleToLegacyUserRole } from '../../../../lib/tenancy'
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

const completeSchema = z.object({
  token: z.string().min(20),
  phone: phoneSchema,
  homePlaceId: z.string().trim().min(3).max(256),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
  emergencyContact: z.object({
    name: z.string().trim().min(2).max(120),
    phone: phoneSchema,
  }).strict().nullable(),
  schoolPlaceId: z.string().trim().min(3).max(256).nullable(),
  studySchedule: z.array(weeklyWindowSchema).max(35),
  recurringUnavailability: z.array(recurringWindowSchema).max(35),
}).strict().superRefine((value, ctx) => {
  if (!value.schoolPlaceId && value.studySchedule.length) {
    ctx.addIssue({ code: 'custom', path: ['studySchedule'], message: 'Choose a school before adding study hours.' })
  }
  const studyError = weeklyWindowError(value.studySchedule, 'Study hours')
  if (studyError) ctx.addIssue({ code: 'custom', path: ['studySchedule'], message: studyError })
  const recurringError = weeklyWindowError(value.recurringUnavailability, 'Weekly unavailability')
  if (recurringError) ctx.addIssue({ code: 'custom', path: ['recurringUnavailability'], message: recurringError })
})

class InviteSetupConflict extends Error {}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? ''
  if (token.length < 20) return NextResponse.json({ ok: false, error: 'Invitation token is missing.' }, { status: 400 })

  const context = await getInviteSetupContext(token)
  if (!context) return NextResponse.json({ ok: false, error: 'This invitation is invalid or has expired.' }, { status: 400 })

  const stage = context.user.status === 'active' || context.membership.status === 'active'
    ? 'complete'
    : context.user.password
      ? 'profile'
      : 'password'

  return NextResponse.json({
    ok: true,
    data: {
      stage,
      user: { id: context.user.id, name: context.user.name, email: context.user.email },
      profile: null,
      setupRequired: true,
      managerSetupRequired: true,
    },
  })
}

export async function POST(request: NextRequest) {
  const parsed = completeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: 'Check your contact, mapped locations and weekly availability before creating the account.',
      details: parsed.error.flatten(),
    }, { status: 400 })
  }

  const context = await getInviteSetupContext(parsed.data.token)
  if (!context) return NextResponse.json({ ok: false, error: 'This invitation is invalid or has expired.' }, { status: 400 })
  if (!context.user.password) {
    return NextResponse.json({ ok: false, error: 'Create your password before completing account setup.' }, { status: 409 })
  }
  if (!['employee', 'field_supervisor'].includes(context.membership.role)) {
    return NextResponse.json({ ok: false, error: 'This role does not require an operational profile setup.' }, { status: 409 })
  }
  if (context.user.status === 'active' || context.membership.status === 'active') {
    return NextResponse.json({ ok: false, error: 'This account setup is already complete.' }, { status: 409 })
  }

  let home
  let school = null
  try {
    home = await resolveGooglePlace(parsed.data.homePlaceId, 'home')
    school = parsed.data.schoolPlaceId ? await resolveGooglePlace(parsed.data.schoolPlaceId, 'school') : null
  } catch (error) {
    if (error instanceof GooglePlacesError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    throw error
  }

  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.authToken.updateMany({
        where: { id: context.token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      if (claim.count !== 1) throw new InviteSetupConflict('This invitation was already used or expired.')

      const existing = await tx.workforceProfile.findUnique({
        where: { userId: context.user.id },
        select: { id: true, organizationId: true },
      })
      if (existing && existing.organizationId !== context.membership.organizationId) {
        throw new InviteSetupConflict('This profile belongs to another organization.')
      }

      const commonData = {
        phone: normalizePhoneNumber(parsed.data.phone),
        homeLabel: 'Home',
        homeAddress: home.formattedAddress,
        homeLatitude: home.latitude,
        homeLongitude: home.longitude,
        travelMode: parsed.data.travelMode,
        emergencyContactName: parsed.data.emergencyContact?.name ?? null,
        emergencyContactPhone: parsed.data.emergencyContact ? normalizePhoneNumber(parsed.data.emergencyContact.phone) : null,
        schoolName: school?.displayName ?? null,
        schoolAddress: school?.formattedAddress ?? null,
        schoolLatitude: school?.latitude ?? null,
        schoolLongitude: school?.longitude ?? null,
      }

      const profile = existing
        ? await tx.workforceProfile.update({ where: { id: existing.id }, data: commonData })
        : await tx.workforceProfile.create({
            data: {
              organizationId: context.membership.organizationId,
              userId: context.user.id,
              ...commonData,
              weeklyTargetMinutes: 0,
              weeklyTargetConfigured: false,
            },
          })

      await tx.studySchedule.deleteMany({ where: { profileId: profile.id } })
      if (school && parsed.data.studySchedule.length) {
        await tx.studySchedule.createMany({
          data: parsed.data.studySchedule.map((rule) => ({
            organizationId: context.membership.organizationId,
            profileId: profile.id,
            ...rule,
          })),
        })
      }

      await tx.recurringUnavailability.deleteMany({ where: { profileId: profile.id } })
      if (parsed.data.recurringUnavailability.length) {
        await tx.recurringUnavailability.createMany({
          data: parsed.data.recurringUnavailability.map((rule) => ({
            organizationId: context.membership.organizationId,
            profileId: profile.id,
            dayOfWeek: rule.dayOfWeek,
            startsMinute: rule.startsMinute,
            endsMinute: rule.endsMinute,
            reason: rule.reason?.trim() || null,
          })),
        })
      }

      await tx.user.update({
        where: { id: context.user.id },
        data: { status: 'active' },
      })
      await tx.membership.update({
        where: { id: context.membership.id },
        data: { status: 'active' },
      })

      const managers = await tx.membership.findMany({
        where: {
          organizationId: context.membership.organizationId,
          status: 'active',
          role: { in: ['organization_admin', 'field_supervisor', 'scheduler'] },
          userId: { not: context.user.id },
        },
        select: { userId: true },
      })
      if (managers.length) {
        await tx.operationalNotice.create({
          data: {
            organizationId: context.membership.organizationId,
            type: 'schedule_change',
            priority: 'normal',
            title: 'Employee account setup completed',
            body: `${context.user.name ?? context.user.email} completed their mapped profile and recurring availability. Set company-owned weekly target / employment settings before automatic scheduling.`,
            requiresAcknowledgement: false,
            createdById: context.user.id,
            recipients: {
              create: managers.map(({ userId }) => ({ organizationId: context.membership.organizationId, userId })),
            },
          },
        })
      }

      return profile
    })

    await logAudit(
      context.user.email,
      'complete_invited_account_setup',
      'user',
      context.user.id,
      {
        profileId: result.id,
        homePlaceId: home.placeId,
        schoolPlaceId: school?.placeId ?? null,
        studyWindows: parsed.data.studySchedule.length,
        recurringUnavailableWindows: parsed.data.recurringUnavailability.length,
        managerSetupRequired: true,
      },
      context.membership.organizationId,
    )

    const role = membershipRoleToLegacyUserRole(context.membership.role)
    const accessToken = await createSessionToken(context.user.email, role, context.membership.organizationId, {
      ttlSeconds: sessionCookie.maxAge,
      audience: 'web',
    })
    const response = NextResponse.json({
      ok: true,
      data: {
        nextUrl: '/profile',
        managerSetupRequired: true,
      },
    })
    response.cookies.set(sessionCookie.name, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionCookie.maxAge,
      secure: process.env.NODE_ENV === 'production',
    })
    return response
  } catch (error) {
    if (error instanceof InviteSetupConflict) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 })
    }
    throw error
  }
}
