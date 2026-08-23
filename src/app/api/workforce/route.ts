import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { haversineKm, travelEstimate, workforceProfileFor } from '../../../lib/workforce-profiles'

const querySchema = z.object({ range: z.enum(['week', 'fortnight', 'month', 'quarter']).default('week') })
const rangeDays = { week: 7, fortnight: 14, month: 30, quarter: 90 } as const

function minutesBetween(start: Date, end: Date) { return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) }

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid range.' }, { status: 400 })

  const now = new Date()
  const from = new Date(now.getTime() - rangeDays[parsed.data.range] * 86_400_000)
  const organizationId = auth.user.organizationId
  const [users, visits, entries, feedback] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'active', memberships: { some: { organizationId, status: 'active', role: { in: ['employee', 'supervisor'] } } } },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    }),
    prisma.visit.findMany({
      where: { organizationId, scheduledStart: { gte: from, lte: now } },
      select: {
        id: true, status: true, scheduledStart: true, scheduledEnd: true,
        site: { select: { id: true, name: true, city: true, addressLine1: true, latitude: true, longitude: true, client: { select: { displayName: true } } } },
        assignments: { select: { userId: true, status: true } },
      },
      orderBy: { scheduledStart: 'desc' },
      take: 1200,
    }),
    prisma.timeEntry.findMany({
      where: { organizationId, startedAt: { gte: from, lte: now }, status: { in: ['completed', 'approved', 'needs_review'] } },
      select: { userId: true, durationSeconds: true, status: true, startLocationClass: true, visitId: true },
      take: 1600,
    }),
    prisma.feedbackEntry.findMany({ where: { organizationId, createdAt: { gte: from, lte: now } }, select: { employeeId: true, overall: true } }),
  ])

  const employees = users.map((user) => {
    const profile = workforceProfileFor(user.email)
    const assigned = visits.filter((visit) => visit.assignments.some((assignment) => assignment.userId === user.id && assignment.status !== 'declined'))
    const completed = assigned.filter((visit) => visit.status === 'completed')
    const relatedEntries = entries.filter((entry) => entry.userId === user.id)
    const plannedMinutes = assigned.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0)
    const actualMinutes = Math.round(relatedEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0) / 60)
    const siteIds = new Set(completed.map((visit) => visit.site.id))
    const ratings = feedback.filter((item) => item.employeeId === user.id).map((item) => item.overall)
    const locationExceptions = relatedEntries.filter((entry) => ['suspicious', 'unavailable'].includes(entry.startLocationClass ?? '') || entry.status === 'needs_review').length
    const nextVisit = assigned.filter((visit) => visit.status !== 'completed').sort((a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime())[0] ?? assigned[0]
    const nextDistanceKm = nextVisit?.site.latitude && nextVisit.site.longitude ? haversineKm(profile.home, { latitude: Number(nextVisit.site.latitude), longitude: Number(nextVisit.site.longitude) }) : null
    return {
      id: user.id, name: user.name || user.email, email: user.email, profile,
      plannedMinutes, actualMinutes, completedVisits: completed.length, scheduledVisits: assigned.length, sitesServed: siteIds.size,
      locationExceptions, qualityAverage: ratings.length ? Math.round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length * 10) / 10 : null,
      nextVisit: nextVisit ? { id: nextVisit.id, startsAt: nextVisit.scheduledStart, site: nextVisit.site } : null,
      nextDistanceKm: nextDistanceKm == null ? null : Math.round(nextDistanceKm * 10) / 10,
    }
  }).sort((a, b) => b.actualMinutes - a.actualMinutes || b.completedVisits - a.completedVisits)

  const sites = Array.from(new Map(visits.map((visit) => [visit.site.id, visit.site])).values()).map((site) => ({
    ...site,
    latitude: site.latitude == null ? null : Number(site.latitude), longitude: site.longitude == null ? null : Number(site.longitude),
    assignedEmployeeIds: Array.from(new Set(visits.filter((visit) => visit.site.id === site.id).flatMap((visit) => visit.assignments.map((assignment) => assignment.userId)))),
  }))
  const plannedMinutes = employees.reduce((sum, item) => sum + item.plannedMinutes, 0)
  const actualMinutes = employees.reduce((sum, item) => sum + item.actualMinutes, 0)

  return NextResponse.json({ ok: true, data: {
    generatedAt: now, range: parsed.data.range, from, to: now,
    summary: { employees: employees.length, plannedMinutes, actualMinutes, completedVisits: employees.reduce((sum, item) => sum + item.completedVisits, 0), siteCoverage: new Set(employees.flatMap((item) => item.nextVisit?.site.id ? [item.nextVisit.site.id] : [])).size },
    employees, sites,
    routeProvider: 'Estimated Dublin travel time. Open Google Maps for live traffic and turn-by-turn routing.',
  } })
}
