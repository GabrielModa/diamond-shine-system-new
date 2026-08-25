import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'

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
  home: locationSchema,
  school: locationSchema.extend({ name: z.string().trim().min(1).max(120) }).nullable().optional(),
  weeklyTargetMinutes: z.number().int().min(60).max(3600),
  travelMode: z.enum(['driving', 'transit', 'cycling']),
  studySchedule: z.array(scheduleSchema).max(21),
  schoolHolidays: z.array(leaveSchema).max(24),
  personalLeaves: z.array(leaveSchema).max(24),
})

async function targetAuth(request: NextRequest, userId: string) {
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth
  if (auth.user.role === 'employee' && auth.user.id !== userId) {
    return { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  }
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'active', memberships: { some: { organizationId: auth.user.organizationId, status: 'active' } } },
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
  const auth = await targetAuth(request, userId)
  if ('response' in auth) return auth.response
  const profile = await prisma.workforceProfile.findFirst({
    where: { userId, organizationId: auth.user.organizationId },
    include: { studySchedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsMinute: 'asc' }] }, leaves: { orderBy: { startsAt: 'asc' } } },
  })
  return NextResponse.json({ ok: true, data: { user: auth.target, profile: serialize(profile), setupRequired: !profile } })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const auth = await targetAuth(request, userId)
  if ('response' in auth) return auth.response
  const parsed = inputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid workforce profile.', details: parsed.error.flatten() }, { status: 400 })
  const data = parsed.data
  const school = data.school ?? null
  const profile = await prisma.$transaction(async (tx) => {
    const saved = await tx.workforceProfile.upsert({
      where: { userId },
      update: {
        homeLabel: data.home.label ?? 'Home', homeAddress: data.home.address,
        homeLatitude: data.home.latitude ?? null, homeLongitude: data.home.longitude ?? null,
        schoolName: school?.name ?? null, schoolAddress: school?.address ?? null,
        schoolLatitude: school?.latitude ?? null, schoolLongitude: school?.longitude ?? null,
        weeklyTargetMinutes: data.weeklyTargetMinutes, travelMode: data.travelMode,
      },
      create: {
        organizationId: auth.user.organizationId, userId,
        homeLabel: data.home.label ?? 'Home', homeAddress: data.home.address,
        homeLatitude: data.home.latitude ?? null, homeLongitude: data.home.longitude ?? null,
        schoolName: school?.name ?? null, schoolAddress: school?.address ?? null,
        schoolLatitude: school?.latitude ?? null, schoolLongitude: school?.longitude ?? null,
        weeklyTargetMinutes: data.weeklyTargetMinutes, travelMode: data.travelMode,
      },
    })
    await tx.studySchedule.deleteMany({ where: { profileId: saved.id } })
    await tx.workforceLeave.deleteMany({ where: { profileId: saved.id } })
    if (school && data.studySchedule.length) {
      await tx.studySchedule.createMany({ data: data.studySchedule.map((r) => ({ organizationId: auth.user.organizationId, profileId: saved.id, ...r })) })
    }
    const leaves = [
      ...data.schoolHolidays.map((l) => ({ ...l, kind: 'school_holiday' })),
      ...data.personalLeaves.map((l) => ({ ...l, kind: 'personal_leave' })),
    ]
    if (leaves.length) {
      await tx.workforceLeave.createMany({ data: leaves.map((l) => ({ organizationId: auth.user.organizationId, profileId: saved.id, kind: l.kind, startsAt: new Date(l.startsAt), endsAt: new Date(l.endsAt), reason: l.reason ?? null })) })
    }
    return tx.workforceProfile.findUniqueOrThrow({ where: { id: saved.id }, include: { studySchedules: true, leaves: true } })
  })
  return NextResponse.json({ ok: true, data: { user: auth.target, profile: serialize(profile) } })
}
