import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../lib/auth'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { resolveWorkforcePeriod } from '../../../lib/workforce-period'
import { prisma } from '../../../lib/prisma'
import { haversineKm } from '../../../lib/workforce-profiles'
import { capacityBand, remainingCapacityMinutes, resolveWorkforceContext } from '../../../lib/workforce-availability'
import { qualityBand, qualityLabel, qualityTrend } from '../../../lib/workforce-quality'

const querySchema = z.object({
  range: z.enum(['week', 'fortnight', 'month', 'quarter']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}
function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}
function addDays(date: Date, amount: number) {
  return new Date(date.getTime() + amount * 86400000)
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid workforce period.' }, { status: 400 })

  const now = new Date()
  const organizationId = auth.user.organizationId
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
  const timezone = org?.timezone ?? 'Europe/Dublin'
  const period = resolveWorkforcePeriod(parsed.data, now, timezone)
  if (!period) return NextResponse.json({ ok: false, error: 'Invalid date range.' }, { status: 400 })
  const periodWeekdays = period.weekdays
  const visitQueryFrom = period.from < now ? period.from : now
  const visitQueryTo = period.to > addDays(now, 90) ? period.to : addDays(now, 90)

  const [users, visits, entries, feedback, temporaryAvailability] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: 'active',
        memberships: {
          some: {
            organizationId,
            status: 'active',
            role: { in: ['employee', 'field_supervisor'] },
          },
        },
      },
      select: {
        id: true, name: true, email: true,
        workforceProfile: { include: { studySchedules: true, recurringUnavailability: true, leaves: true } },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
    prisma.visit.findMany({
      where: { organizationId, scheduledStart: { gte: visitQueryFrom, lte: visitQueryTo } },
      select: {
        id: true, status: true, scheduledStart: true, scheduledEnd: true,
        site: {
          select: {
            id: true, name: true, city: true, addressLine1: true, latitude: true, longitude: true,
            client: { select: { displayName: true } },
          },
        },
        assignments: { select: { userId: true, status: true } },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 1800,
    }),
    prisma.timeEntry.findMany({
      where: {
        organizationId,
        startedAt: { gte: period.from, lt: period.toExclusive },
        status: { in: ['completed', 'approved', 'needs_review'] },
      },
      select: {
        userId: true, startedAt: true, durationSeconds: true, status: true,
        startLocationClass: true, kind: true,
      },
      take: 3000,
    }),
    prisma.feedbackEntry.findMany({
      where: { organizationId, createdAt: { gte: period.from, lt: period.toExclusive } },
      select: { employeeId: true, overall: true, cleanliness: true, punctuality: true, equipment: true, clientRelations: true, category: true, createdAt: true },
    }),
    prisma.availability.findMany({
      where: {
        organizationId,
        cancelledAt: null,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: { id: true, userId: true, startsAt: true, endsAt: true, reason: true },
    }),
  ])

  const employees = users.map((user) => {
    const db = user.workforceProfile
    const setupRequired = !db || !db.weeklyTargetConfigured
    const home = db ? {
      kind: 'home' as const, label: db.homeLabel, address: db.homeAddress,
      latitude: db.homeLatitude == null ? null : Number(db.homeLatitude),
      longitude: db.homeLongitude == null ? null : Number(db.homeLongitude),
    } : {
      kind: 'home' as const, label: 'Home', address: 'Not configured',
      latitude: null, longitude: null,
    }
    const school = db?.schoolAddress ? {
      kind: 'school' as const, label: db.schoolName ?? 'School', address: db.schoolAddress,
      latitude: db.schoolLatitude == null ? null : Number(db.schoolLatitude),
      longitude: db.schoolLongitude == null ? null : Number(db.schoolLongitude),
    } : null

    const studySchedule = db?.studySchedules.map((r) => ({
      dayOfWeek: r.dayOfWeek, startsMinute: r.startsMinute, endsMinute: r.endsMinute,
    })) ?? []
    const recurringUnavailability = db?.recurringUnavailability.map((rule) => ({
      dayOfWeek: rule.dayOfWeek, startsMinute: rule.startsMinute, endsMinute: rule.endsMinute, reason: rule.reason,
    })) ?? []
    const leaves = db?.leaves.map((l) => ({
      kind: l.kind as 'school_holiday' | 'personal_leave',
      startsAt: l.startsAt, endsAt: l.endsAt, reason: l.reason,
    })) ?? []
    const activeTemporary = temporaryAvailability.find((entry) => entry.userId === user.id) ?? null
    const resolvedContext = setupRequired
      ? {
          state: 'home' as const,
          availableForScheduling: false,
          origin: null,
          personalLeave: null,
          schoolHolidayActive: false,
          activeStudyRule: null,
          activeRecurringRule: null,
        }
      : resolveWorkforceContext({ timezone, home, school, studySchedule, recurringUnavailability, leaves }, now)
    const context = activeTemporary
      ? {
          ...resolvedContext,
          state: 'temporary_unavailability' as const,
          availableForScheduling: false,
          origin: null,
          temporaryUnavailability: activeTemporary,
        }
      : { ...resolvedContext, temporaryUnavailability: null }

    const allAssigned = visits.filter((visit) =>
      visit.status !== 'cancelled' && visit.status !== 'missed' && visit.assignments.some((a) => a.userId === user.id && ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)))
    const periodAssigned = allAssigned.filter((visit) =>
      visit.scheduledStart >= period.from && visit.scheduledStart < period.toExclusive)
    const completed = periodAssigned.filter((visit) => visit.status === 'completed')
    const relatedEntries = entries.filter((entry) => entry.userId === user.id)

    const plannedMinutes = periodAssigned.reduce((sum, visit) =>
      sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0)
    const actualMinutes = Math.round(relatedEntries.reduce((sum, entry) =>
      sum + (entry.durationSeconds ?? 0), 0) / 60)

    const weeklyTargetMinutes = setupRequired ? 0 : db!.weeklyTargetMinutes
    const periodTargetMinutes = Math.round(weeklyTargetMinutes * periodWeekdays / 5)
    const remaining = remainingCapacityMinutes(periodTargetMinutes, plannedMinutes)
    const nextVisit = allAssigned.find((visit) =>
      visit.status !== 'completed' && visit.status !== 'cancelled' && visit.scheduledStart >= now) ?? null

    const employeeFeedback = feedback
      .filter((item) => item.employeeId === user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    const ratings = employeeFeedback.map((item) => item.overall)
    const lowFeedbackCount = employeeFeedback.filter((item) => item.overall < 3.5).length
    const qualityAverage = ratings.length
      ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 10) / 10
      : null
    const categoryAverage = (key: 'cleanliness'|'punctuality'|'equipment'|'clientRelations') =>
      employeeFeedback.length
        ? Math.round(employeeFeedback.reduce((sum, item) => sum + item[key], 0) / employeeFeedback.length * 10) / 10
        : null
    const origin = context.origin
    const nextDistanceKm =
      origin?.latitude != null && origin.longitude != null &&
      nextVisit?.site.latitude != null && nextVisit.site.longitude != null
        ? haversineKm(
            { latitude: origin.latitude, longitude: origin.longitude },
            { latitude: Number(nextVisit.site.latitude), longitude: Number(nextVisit.site.longitude) },
          )
        : null

    const daily = new Map<string, { date: string; actualMinutes: number; plannedMinutes: number }>()
    for (let cursor = new Date(period.from); cursor <= period.to; cursor = addDays(cursor, 1)) {
      const date = dayKey(cursor, timezone)
      daily.set(date, { date, actualMinutes: 0, plannedMinutes: 0 })
    }
    for (const entry of relatedEntries) {
      const key = dayKey(entry.startedAt, timezone)
      const row = daily.get(key)
      if (row) row.actualMinutes += Math.round((entry.durationSeconds ?? 0) / 60)
    }
    for (const visit of periodAssigned) {
      const key = dayKey(visit.scheduledStart, timezone)
      const row = daily.get(key)
      if (row) row.plannedMinutes += minutesBetween(visit.scheduledStart, visit.scheduledEnd)
    }

    const utilization = periodTargetMinutes
      ? Math.round(plannedMinutes / periodTargetMinutes * 100)
      : 0
    const workedVsPlanned = plannedMinutes
      ? Math.round(actualMinutes / plannedMinutes * 100)
      : actualMinutes > 0 ? 100 : 0

    return {
      id: user.id, name: user.name || user.email, email: user.email,
      profile: {
        setupRequired,
        home, school,
        travelMode: db ? db.travelMode as 'driving' | 'transit' | 'cycling' : null,
        weeklyTargetMinutes, studySchedule, recurringUnavailability, leaves,
      },
      context: { ...context, origin },
      plannedMinutes, actualMinutes, weeklyTargetMinutes, periodTargetMinutes,
      remainingCapacityMinutes: remaining,
      capacityBand: capacityBand(plannedMinutes),
      capacityStatus: setupRequired
        ? 'available'
        : plannedMinutes > periodTargetMinutes
          ? 'over'
          : plannedMinutes >= periodTargetMinutes * .9 ? 'near' : 'available',
      utilization,
      workedVsPlanned,
      completedVisits: completed.length,
      scheduledVisits: periodAssigned.length,
      sitesServed: new Set(completed.map((visit) => visit.site.id)).size,
      locationExceptions: relatedEntries.filter((e) =>
        ['suspicious', 'unavailable'].includes(e.startLocationClass ?? '') || e.status === 'needs_review').length,
      qualityAverage,
      qualityCount: employeeFeedback.length,
      qualityBand: qualityBand(qualityAverage, lowFeedbackCount),
      qualityLabel: qualityLabel(qualityAverage, lowFeedbackCount),
      qualityTrend: qualityTrend(ratings),
      qualityIssues: lowFeedbackCount,
      qualityBreakdown: {
        cleanliness: categoryAverage('cleanliness'),
        punctuality: categoryAverage('punctuality'),
        equipment: categoryAverage('equipment'),
        clientRelations: categoryAverage('clientRelations'),
      },
      nextVisit: nextVisit ? { id: nextVisit.id, startsAt: nextVisit.scheduledStart, site: nextVisit.site } : null,
      nextDistanceKm: nextDistanceKm == null ? null : Math.round(nextDistanceKm * 10) / 10,
      dailyBreakdown: Array.from(daily.values()),
    }
  })

  const sites = Array.from(new Map(visits.map((visit) => [visit.site.id, visit.site])).values()).map((site) => {
    const upcomingVisits = visits.filter((visit) =>
      visit.site.id === site.id &&
      visit.scheduledStart >= now &&
      !['cancelled', 'completed', 'missed'].includes(visit.status))
    const assignedEmployeeIds = Array.from(new Set(upcomingVisits.flatMap((visit) =>
      visit.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)).map((assignment) => assignment.userId))))
    const needsStaff = upcomingVisits.some((visit) =>
      !visit.assignments.some((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)))

    return {
      ...site,
      latitude: site.latitude == null ? null : Number(site.latitude),
      longitude: site.longitude == null ? null : Number(site.longitude),
      assignedEmployeeIds,
      coverageState: needsStaff ? 'needs_staff' as const : upcomingVisits.length ? 'covered' as const : 'no_upcoming' as const,
      upcomingVisits: upcomingVisits.length,
    }
  })

  return NextResponse.json({ ok: true, data: {
    generatedAt: now,
    period: { from: period.from, to: period.to, preset: period.label, weekdays: periodWeekdays },
    summary: {
      employees: employees.length,
      availableEmployees: employees.filter((e) => e.context.availableForScheduling).length,
      plannedMinutes: employees.reduce((s, e) => s + e.plannedMinutes, 0),
      actualMinutes: employees.reduce((s, e) => s + e.actualMinutes, 0),
      targetMinutes: employees.reduce((s, e) => s + e.periodTargetMinutes, 0),
      remainingCapacityMinutes: employees.reduce((s, e) => s + e.remainingCapacityMinutes, 0),
      personalLeave: employees.filter((e) => e.context.state === 'personal_leave').length,
      schoolNow: employees.filter((e) => e.context.state === 'school').length,
      completedVisits: employees.reduce((s, e) => s + e.completedVisits, 0),
      siteCoverage: new Set(employees.flatMap((e) => e.nextVisit?.site.id ? [e.nextVisit.site.id] : [])).size,
    },
    employees,
    sites,
  }})
}
