import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'
import { resolveWorkforceContext } from '../../../../lib/workforce-availability'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../modules/scheduling/assignment-lifecycle'
import { resolveWorkforceLiveStatus } from '../../../../modules/workforce/live-status'

const MINUTE = 60_000
const SOON_WINDOW_MS = 45 * MINUTE
const ACTIVE_VISIT_STATUSES = ['scheduled', 'dispatched', 'acknowledged', 'in_progress', 'completion_blocked'] as const

function sitePayload(site: {
  id: string
  name: string
  city: string
  addressLine1: string
  latitude: unknown
  longitude: unknown
  client: { displayName: string }
}) {
  return {
    id: site.id,
    name: site.name,
    city: site.city,
    addressLine1: site.addressLine1,
    latitude: site.latitude == null ? null : Number(site.latitude),
    longitude: site.longitude == null ? null : Number(site.longitude),
    client: site.client,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response

  const now = new Date()
  const organizationId = auth.user.organizationId
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  })
  const timezone = organization?.timezone ?? 'Europe/Dublin'
  const soonUntil = new Date(now.getTime() + SOON_WINDOW_MS)

  const [users, temporaryAvailability, visits, runningEntries] = await Promise.all([
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
        id: true,
        name: true,
        email: true,
        workforceProfile: {
          include: {
            studySchedules: true,
            recurringUnavailability: true,
            leaves: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
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
    prisma.visit.findMany({
      where: {
        organizationId,
        status: { in: [...ACTIVE_VISIT_STATUSES] },
        scheduledStart: { lt: soonUntil },
        scheduledEnd: { gt: now },
      },
      select: {
        id: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        site: {
          select: {
            id: true,
            name: true,
            city: true,
            addressLine1: true,
            latitude: true,
            longitude: true,
            client: { select: { displayName: true } },
          },
        },
        assignments: {
          where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          select: { userId: true, status: true },
        },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 500,
    }),
    prisma.timeEntry.findMany({
      where: {
        organizationId,
        status: 'running',
        kind: 'visit',
      },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        startLocationClass: true,
        startDistanceM: true,
        visit: {
          select: {
            id: true,
            status: true,
            scheduledStart: true,
            scheduledEnd: true,
            site: {
              select: {
                id: true,
                name: true,
                city: true,
                addressLine1: true,
                latitude: true,
                longitude: true,
                client: { select: { displayName: true } },
              },
            },
            incidents: {
              where: { status: { notIn: ['resolved', 'closed'] } },
              select: { id: true, severity: true, title: true, status: true },
            },
          },
        },
        locationEvents: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: {
            capturedAt: true,
            classification: true,
            distanceM: true,
            accuracyM: true,
            kind: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
    }),
  ])

  const employees = users.map((user) => {
    const profile = user.workforceProfile
    const setupRequired = !profile || !profile.weeklyTargetConfigured
    const home = profile ? {
      label: profile.homeLabel,
      address: profile.homeAddress,
      latitude: profile.homeLatitude == null ? null : Number(profile.homeLatitude),
      longitude: profile.homeLongitude == null ? null : Number(profile.homeLongitude),
    } : null
    const school = profile?.schoolAddress ? {
      label: profile.schoolName ?? 'School',
      address: profile.schoolAddress,
      latitude: profile.schoolLatitude == null ? null : Number(profile.schoolLatitude),
      longitude: profile.schoolLongitude == null ? null : Number(profile.schoolLongitude),
    } : null

    const activeTemporary = temporaryAvailability.find((entry) => entry.userId === user.id) ?? null
    const baseContext = setupRequired || !home
      ? null
      : resolveWorkforceContext({
          timezone,
          home: { kind: 'home', ...home },
          school: school ? { kind: 'school', ...school } : null,
          studySchedule: profile!.studySchedules.map((rule) => ({
            dayOfWeek: rule.dayOfWeek,
            startsMinute: rule.startsMinute,
            endsMinute: rule.endsMinute,
          })),
          recurringUnavailability: profile!.recurringUnavailability.map((rule) => ({
            dayOfWeek: rule.dayOfWeek,
            startsMinute: rule.startsMinute,
            endsMinute: rule.endsMinute,
            reason: rule.reason,
          })),
          leaves: profile!.leaves.map((leave) => ({
            kind: leave.kind as 'school_holiday' | 'personal_leave',
            startsAt: leave.startsAt,
            endsAt: leave.endsAt,
            reason: leave.reason,
          })),
        }, now)

    const contextState = setupRequired
      ? 'temporary_unavailability' as const
      : activeTemporary
        ? 'temporary_unavailability' as const
        : baseContext?.state ?? 'home'

    const assignedVisits = visits.filter((visit) => visit.assignments.some((assignment) => assignment.userId === user.id))
    const currentVisit = assignedVisits.find((visit) => visit.scheduledStart <= now && now < visit.scheduledEnd) ?? null
    const nextVisit = assignedVisits.find((visit) => visit.scheduledStart > now) ?? null
    const runningForUser = runningEntries.filter((entry) => entry.userId === user.id)
    const running = runningForUser[0] ?? null
    const latestSignal = running?.locationEvents[0] ?? null
    const activeVisit = running?.visit ?? currentVisit
    const criticalIncident = running?.visit?.incidents.find((incident) => incident.severity === 'critical') ?? null
    const signalCapturedAt = latestSignal?.capturedAt ?? (running?.startLocationClass ? running.startedAt : null)

    const live = resolveWorkforceLiveStatus({
      now,
      contextState,
      runningEntry: running ? {
        startedAt: running.startedAt,
        lastSignalAt: signalCapturedAt,
        locationClassification: latestSignal?.classification ?? running.startLocationClass,
        hasCriticalIncident: Boolean(criticalIncident),
      } : null,
      currentVisit: currentVisit ? {
        id: currentVisit.id,
        scheduledStart: currentVisit.scheduledStart,
        scheduledEnd: currentVisit.scheduledEnd,
      } : null,
      nextVisit: nextVisit ? {
        id: nextVisit.id,
        scheduledStart: nextVisit.scheduledStart,
        scheduledEnd: nextVisit.scheduledEnd,
      } : null,
    })

    const visitForAction = activeVisit ?? nextVisit
    const operationalSite = visitForAction ? sitePayload(visitForAction.site) : null
    const mapPoint = live.state === 'on_job' || live.state === 'starting_soon' || live.state === 'attention'
      ? operationalSite?.latitude != null && operationalSite.longitude != null
        ? {
            kind: live.state === 'on_job' ? 'active_visit_site' as const : 'expected_visit_site' as const,
            latitude: operationalSite.latitude,
            longitude: operationalSite.longitude,
            label: `${operationalSite.client.displayName} · ${operationalSite.name}`,
          }
        : null
      : live.state === 'expected_school' && school?.latitude != null && school.longitude != null
        ? {
            kind: 'expected_school' as const,
            latitude: school.latitude,
            longitude: school.longitude,
            label: school.label,
          }
        : null

    const signalAgeSeconds = signalCapturedAt
      ? Math.max(0, Math.round((now.getTime() - signalCapturedAt.getTime()) / 1000))
      : null

    return {
      id: user.id,
      name: user.name ?? user.email,
      email: user.email,
      setupRequired,
      state: live.state,
      attention: live.attention || runningForUser.length > 1,
      attentionReason: runningForUser.length > 1
        ? 'More than one active timer exists for this team member.'
        : live.attentionReason,
      signal: {
        state: live.signalState,
        capturedAt: signalCapturedAt,
        ageSeconds: signalAgeSeconds,
        classification: latestSignal?.classification ?? running?.startLocationClass ?? null,
        distanceM: latestSignal?.distanceM ?? running?.startDistanceM ?? null,
        accuracyM: latestSignal?.accuracyM ?? null,
      },
      timer: running ? { id: running.id, startedAt: running.startedAt } : null,
      currentVisit: activeVisit ? {
        id: activeVisit.id,
        status: activeVisit.status,
        scheduledStart: activeVisit.scheduledStart,
        scheduledEnd: activeVisit.scheduledEnd,
        site: sitePayload(activeVisit.site),
      } : null,
      nextVisit: !activeVisit && nextVisit ? {
        id: nextVisit.id,
        status: nextVisit.status,
        scheduledStart: nextVisit.scheduledStart,
        scheduledEnd: nextVisit.scheduledEnd,
        site: sitePayload(nextVisit.site),
      } : null,
      expectedContext: {
        state: contextState,
        school: school ? { label: school.label, address: school.address } : null,
        temporaryReason: activeTemporary?.reason ?? null,
      },
      mapPoint,
      criticalIncident: criticalIncident ? {
        id: criticalIncident.id,
        title: criticalIncident.title,
        status: criticalIncident.status,
      } : null,
    }
  })

  const visible = employees.filter((employee) => employee.state !== 'unavailable')
  return NextResponse.json({
    ok: true,
    data: {
      generatedAt: now,
      timezone,
      summary: {
        people: employees.length,
        visible: visible.length,
        onJob: employees.filter((employee) => employee.state === 'on_job').length,
        startingSoon: employees.filter((employee) => employee.state === 'starting_soon').length,
        attention: employees.filter((employee) => employee.attention || employee.state === 'attention').length,
        expectedSchool: employees.filter((employee) => employee.state === 'expected_school').length,
        available: employees.filter((employee) => employee.state === 'available').length,
        unavailable: employees.filter((employee) => employee.state === 'unavailable').length,
      },
      employees,
    },
  })
}
