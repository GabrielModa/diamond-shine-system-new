import type { Prisma } from '@prisma/client'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../modules/scheduling/assignment-lifecycle'
import { formatOperationalDateTime } from './operational-time'
import { enqueueNotification } from './notification-queue'
import type { OperationalEmailData, OperationalEmailTone } from './operational-email'
import { prisma } from './prisma'

type AuditNotificationInput = {
  auditLogId?: string
  actorEmail: string
  action: string
  targetType: string
  targetId?: string
  metadata?: Record<string, unknown>
  organizationId: string
}

const MANAGEMENT_ROLES = ['organization_admin', 'field_supervisor', 'scheduler'] as const

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function bool(value: unknown) {
  return value === true
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function displayPerson(person?: { name?: string | null; email: string } | null) {
  return person?.name?.trim() || person?.email || 'Team member'
}

function roleLabel(value: string) {
  return ({
    organization_admin: 'Organization administrator',
    field_supervisor: 'Field supervisor',
    scheduler: 'Scheduler',
    employee: 'Cleaner',
    stock_controller: 'Stock controller',
    quality_inspector: 'Quality inspector',
    finance: 'Finance',
    viewer: 'Viewer',
    admin: 'Administrator',
    supervisor: 'Supervisor',
  } as Record<string, string>)[value] ?? value.replaceAll('_', ' ')
}

function statusLabel(value: string) {
  return ({ invited: 'Invited', active: 'Active', suspended: 'Suspended', removed: 'Removed', pending: 'Pending', inactive: 'Inactive' } as Record<string, string>)[value] ?? value
}

function defaultEmailAction(
  input: AuditNotificationInput,
  entityType: string,
  entityId?: string,
): OperationalEmailData['action'] | undefined {
  const encodedId = entityId ? encodeURIComponent(entityId) : ''
  switch (input.action) {
    case 'visit_assignment_response':
    case 'declare_unavailability':
    case 'cancel_unavailability':
      return { label: 'Review schedule', path: '/schedule' }
    case 'create_time_entry_dispute':
      return { label: 'Review time correction', path: '/field-control' }
    case 'resolve_time_entry_dispute':
      return { label: 'Open time records', path: '/timesheets' }
    case 'report_incident':
      return { label: 'Review incident', path: encodedId ? `/field-control?incident=${encodedId}` : '/field-control' }
    case 'update_incident':
      return { label: 'Open schedule', path: '/schedule' }
    case 'complete_invited_account_setup':
      return { label: 'Review employee', path: '/people' }
    case 'create_manual_visit':
    case 'update_visit':
      return { label: 'Review visit', path: entityType === 'visit' && encodedId ? `/schedule?visit=${encodedId}` : '/schedule' }
    case 'review_visit':
      return { label: 'Open visit', path: entityType === 'visit' && encodedId ? `/schedule?visit=${encodedId}` : '/schedule' }
    case 'cancel_visit':
    case 'create_job':
    case 'create_client_service':
    case 'change_client_service':
    case 'create_service_pause':
      return { label: 'Open schedule', path: '/schedule' }
    case 'update_user_role':
    case 'update_user_status':
    case 'update_user_identity':
    case 'update_workforce_employment_settings':
      return { label: 'Open Diamond Shine', path: '/home' }
    case 'remove_user_from_organization':
    case 'delete_pending_invitation':
      return undefined
    default:
      if (entityType === 'visit' && encodedId) return { label: 'Open visit', path: `/schedule?visit=${encodedId}` }
      if (['availability', 'job', 'service_plan', 'service_pause'].includes(entityType)) return { label: 'Open schedule', path: '/schedule' }
      return undefined
  }
}

async function managementUserIds(organizationId: string, actorEmail?: string) {
  const managers = await prisma.membership.findMany({
    where: {
      organizationId,
      status: 'active',
      role: { in: [...MANAGEMENT_ROLES] },
      user: { status: 'active' },
    },
    select: { userId: true, user: { select: { email: true } } },
  })
  return managers
    .filter((membership) => !actorEmail || membership.user.email.toLowerCase() !== actorEmail.toLowerCase())
    .map((membership) => membership.userId)
}

async function queueEmail(
  input: AuditNotificationInput,
  data: OperationalEmailData,
  entityType = input.targetType,
  entityId = input.targetId,
) {
  if (!(data.userIds?.length || data.recipientEmails?.length)) return
  const action = data.action ?? defaultEmailAction(input, entityType, entityId)
  await enqueueNotification({
    organizationId: input.organizationId,
    kind: 'operational_email',
    createdBy: input.actorEmail,
    entityType,
    entityId: input.auditLogId ?? entityId,
    payload: { ...data, ...(action ? { action } : {}) } as unknown as Prisma.InputJsonValue,
  })
}

async function visitContext(organizationId: string, visitId: string) {
  return prisma.visit.findFirst({
    where: { id: visitId, organizationId },
    include: {
      site: { include: { client: { select: { displayName: true } } } },
      job: { select: { id: true, name: true } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
}

function visitDetails(visit: NonNullable<Awaited<ReturnType<typeof visitContext>>>) {
  return [
    { label: 'Client', value: visit.site.client.displayName },
    { label: 'Site', value: visit.site.name },
    { label: 'When', value: formatOperationalDateTime(visit.scheduledStart, visit.timezone) },
    { label: 'Service', value: visit.job.name },
  ]
}

async function queueVisitAssignmentResponse(input: AuditNotificationInput) {
  if (!input.targetId) return
  const assignment = await prisma.visitAssignment.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: {
      user: { select: { name: true, email: true } },
      visit: { include: { site: { include: { client: { select: { displayName: true } } } }, job: { select: { name: true } } } },
    },
  })
  if (!assignment) return
  const managers = await managementUserIds(input.organizationId, input.actorEmail)
  if (!managers.length) return

  const accepted = assignment.status === 'acknowledged'
  const recurring = text(input.metadata?.scope) === 'recurring'
  const affectedVisits = Math.max(1, number(input.metadata?.affectedVisits))
  await queueEmail(input, {
    userIds: managers,
    subject: accepted
      ? `Diamond Shine · Schedule confirmed · ${displayPerson(assignment.user)}`
      : `Diamond Shine · Assignment declined · ${displayPerson(assignment.user)}`,
    eyebrow: accepted ? 'Employee response' : 'Action required',
    title: accepted ? 'Cleaning schedule confirmed' : 'Cleaning assignment declined',
    message: accepted
      ? `${displayPerson(assignment.user)} confirmed ${recurring ? 'their recurring cleaning schedule' : 'this cleaning visit'}.`
      : `${displayPerson(assignment.user)} declined this cleaning visit. Review coverage before the service starts.`,
    tone: accepted ? 'success' : 'danger',
    details: [
      { label: 'Employee', value: displayPerson(assignment.user) },
      { label: 'Client', value: assignment.visit.site.client.displayName },
      { label: 'Site', value: assignment.visit.site.name },
      { label: 'When', value: formatOperationalDateTime(assignment.visit.scheduledStart, assignment.visit.timezone) },
      { label: 'Response scope', value: recurring ? `Recurring schedule · ${affectedVisits} upcoming visit${affectedVisits === 1 ? '' : 's'}` : 'This visit' },
      ...(assignment.declineReason ? [{ label: 'Reason', value: assignment.declineReason }] : []),
    ],
  }, 'visit_assignment', assignment.id)
}

async function queueAvailability(input: AuditNotificationInput, cancelled: boolean) {
  if (!input.targetId) return
  const entry = await prisma.availability.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!entry) return
  const selfChange = entry.user.email.toLowerCase() === input.actorEmail.toLowerCase()
  const details = [
    { label: 'Employee', value: displayPerson(entry.user) },
    { label: 'From', value: formatOperationalDateTime(entry.startsAt) },
    { label: 'Until', value: formatOperationalDateTime(entry.endsAt) },
    ...(entry.reason ? [{ label: 'Reason', value: entry.reason }] : []),
  ]
  if (selfChange) {
    const managers = await managementUserIds(input.organizationId, input.actorEmail)
    await queueEmail(input, {
      userIds: managers,
      subject: cancelled
        ? `Diamond Shine · Availability restored · ${displayPerson(entry.user)}`
        : `Diamond Shine · Availability changed · ${displayPerson(entry.user)}`,
      eyebrow: 'Employee availability',
      title: cancelled ? 'Employee removed an unavailable period' : 'Employee added an unavailable period',
      message: cancelled
        ? `${displayPerson(entry.user)} removed a previously declared unavailable period. Review staffing if work had been moved around it.`
        : `${displayPerson(entry.user)} updated when they are unavailable. Check future staffing where this overlaps scheduled work.`,
      tone: cancelled ? 'info' : number(input.metadata?.affectedAssignments) > 0 ? 'warning' : 'info',
      details: [
        ...details,
        ...(!cancelled ? [{ label: 'Existing assignments affected', value: String(number(input.metadata?.affectedAssignments)) }] : []),
      ],
    }, 'availability', entry.id)
  } else {
    await queueEmail(input, {
      userIds: [entry.user.id],
      subject: cancelled ? 'Diamond Shine · Availability period removed' : 'Diamond Shine · Availability period added',
      eyebrow: 'Operations update',
      title: cancelled ? 'Operations removed an availability block' : 'Operations updated your availability',
      message: cancelled
        ? 'Operations removed an unavailable period from your workforce profile.'
        : 'Operations added an unavailable period to your workforce profile. Your scheduled visits are not changed unless Schedule shows an update.',
      tone: 'info',
      details,
    }, 'availability', entry.id)
  }
}

async function queueTimeCorrectionRequest(input: AuditNotificationInput) {
  if (!input.targetId) return
  const dispute = await prisma.timeEntryDispute.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: {
      user: { select: { name: true, email: true } },
      timeEntry: {
        include: {
          visit: { include: { site: { include: { client: { select: { displayName: true } } } } } },
        },
      },
    },
  })
  if (!dispute) return
  const managers = await managementUserIds(input.organizationId, input.actorEmail)
  await queueEmail(input, {
    userIds: managers,
    subject: `Diamond Shine · Time correction requested · ${displayPerson(dispute.user)}`,
    eyebrow: 'Time review',
    title: 'Employee requested a time correction',
    message: `${displayPerson(dispute.user)} questioned one of their recorded time entries. Review the original record and the employee explanation before making a decision.`,
    tone: 'warning',
    details: [
      { label: 'Employee', value: displayPerson(dispute.user) },
      { label: 'Recorded start', value: formatOperationalDateTime(dispute.timeEntry.startedAt) },
      ...(dispute.timeEntry.endedAt ? [{ label: 'Recorded end', value: formatOperationalDateTime(dispute.timeEntry.endedAt) }] : []),
      ...(dispute.timeEntry.visit ? [
        { label: 'Client', value: dispute.timeEntry.visit.site.client.displayName },
        { label: 'Site', value: dispute.timeEntry.visit.site.name },
      ] : []),
      { label: 'Employee explanation', value: dispute.reason },
    ],
  }, 'time_entry_dispute', dispute.id)
}

async function queueTimeCorrectionResolution(input: AuditNotificationInput) {
  if (!input.targetId) return
  const dispute = await prisma.timeEntryDispute.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: { user: { select: { id: true, name: true, email: true } }, timeEntry: true },
  })
  if (!dispute) return
  const accepted = dispute.status === 'approved' || dispute.status === 'accepted'
  await queueEmail(input, {
    userIds: [dispute.user.id],
    subject: `Diamond Shine · Time correction ${accepted ? 'approved' : 'reviewed'}`,
    eyebrow: 'Time review',
    title: accepted ? 'Your time correction was approved' : 'Your time correction was reviewed',
    message: accepted
      ? 'Operations approved your time correction request. Check Time for the latest recorded information.'
      : 'Operations completed the review of your time correction request. The decision and explanation are below.',
    tone: accepted ? 'success' : 'neutral',
    details: [
      { label: 'Recorded start', value: formatOperationalDateTime(dispute.timeEntry.startedAt) },
      { label: 'Decision', value: dispute.status },
      ...(dispute.resolution ? [{ label: 'Operations response', value: dispute.resolution }] : []),
      { label: 'Your request', value: dispute.reason },
    ],
  }, 'time_entry_dispute', dispute.id)
}

async function queueIncidentReported(input: AuditNotificationInput) {
  if (!input.targetId) return
  const incident = await prisma.incident.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: {
      reporter: { select: { name: true, email: true } },
      visit: { include: { site: { include: { client: { select: { displayName: true } } } } } },
    },
  })
  if (!incident) return
  const managers = await managementUserIds(input.organizationId, input.actorEmail)
  const urgent = incident.severity === 'critical' || incident.severity === 'high'
  await queueEmail(input, {
    userIds: managers,
    subject: `Diamond Shine · ${incident.severity.toUpperCase()} site issue · ${incident.visit.site.name}`,
    eyebrow: urgent ? 'Field issue · action required' : 'Field issue',
    title: incident.title,
    message: `${displayPerson(incident.reporter)} reported an issue during a cleaning visit.`,
    tone: incident.severity === 'critical' ? 'danger' : urgent ? 'warning' : 'info',
    details: [
      { label: 'Employee', value: displayPerson(incident.reporter) },
      { label: 'Client', value: incident.visit.site.client.displayName },
      { label: 'Site', value: incident.visit.site.name },
      { label: 'Visit', value: formatOperationalDateTime(incident.visit.scheduledStart, incident.visit.timezone) },
      { label: 'Category', value: incident.category },
      { label: 'Severity', value: incident.severity },
      { label: 'Description', value: incident.description },
    ],
  }, 'incident', incident.id)
}

async function queueIncidentUpdate(input: AuditNotificationInput) {
  if (!input.targetId) return
  const incident = await prisma.incident.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: {
      reporter: { select: { id: true, name: true, email: true } },
      visit: { include: { site: { include: { client: { select: { displayName: true } } } } } },
    },
  })
  if (!incident || incident.reporter.email.toLowerCase() === input.actorEmail.toLowerCase()) return
  const resolved = incident.status === 'resolved' || incident.status === 'closed'
  await queueEmail(input, {
    userIds: [incident.reporter.id],
    subject: `Diamond Shine · Issue ${resolved ? 'resolved' : 'updated'} · ${incident.visit.site.name}`,
    eyebrow: 'Operations response',
    title: resolved ? 'Your reported issue was resolved' : 'Operations updated your reported issue',
    message: `Operations updated the issue you reported at ${incident.visit.site.client.displayName} · ${incident.visit.site.name}.`,
    tone: resolved ? 'success' : 'info',
    details: [
      { label: 'Issue', value: incident.title },
      { label: 'Status', value: incident.status },
      ...(incident.resolution ? [{ label: 'Resolution', value: incident.resolution }] : []),
    ],
  }, 'incident', incident.id)
}

async function queueManualVisit(input: AuditNotificationInput) {
  if (!input.targetId) return
  const visit = await visitContext(input.organizationId, input.targetId)
  if (!visit) return
  const userIds = visit.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)).map((assignment) => assignment.userId)
  await queueEmail(input, {
    userIds,
    subject: `Diamond Shine · New visit assigned · ${visit.site.name}`,
    eyebrow: 'New work',
    title: 'A new cleaning visit was added to your schedule',
    message: `Operations assigned you to ${visit.site.client.displayName} · ${visit.site.name}. Review the visit and confirm it in Schedule.`,
    tone: 'info',
    details: visitDetails(visit),
  }, 'visit', visit.id)
}

async function queueJobAssignment(input: AuditNotificationInput, jobId: string, title = 'New recurring cleaning schedule') {
  const job = await prisma.job.findFirst({
    where: { id: jobId, organizationId: input.organizationId },
    include: { site: { include: { client: { select: { displayName: true } } } } },
  })
  if (!job) return
  const assignments = await prisma.visitAssignment.findMany({
    where: {
      organizationId: input.organizationId,
      status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      visit: { jobId: job.id, status: { notIn: ['cancelled', 'missed', 'completed'] } },
    },
    select: { userId: true, visit: { select: { scheduledStart: true } } },
    orderBy: { visit: { scheduledStart: 'asc' } },
  })
  const userIds = [...new Set(assignments.map((assignment) => assignment.userId))]
  const first = assignments[0]?.visit.scheduledStart ?? job.startDate
  await queueEmail(input, {
    userIds,
    subject: `Diamond Shine · ${title} · ${job.site.name}`,
    eyebrow: 'New work',
    title,
    message: `Operations added cleaning work for ${job.site.client.displayName} · ${job.site.name}. Review Schedule and confirm the assignment when requested.`,
    tone: 'info',
    details: [
      { label: 'Client', value: job.site.client.displayName },
      { label: 'Site', value: job.site.name },
      { label: 'First visit', value: formatOperationalDateTime(first, job.timezone) },
      { label: 'Assigned visits currently generated', value: String(assignments.length) },
    ],
  }, 'job', job.id)
}

async function queueVisitUpdate(input: AuditNotificationInput, cancelled: boolean) {
  if (!input.targetId) return
  const visit = await visitContext(input.organizationId, input.targetId)
  if (!visit) return
  const previous = stringList(input.metadata?.previousAssigneeIds)
  const current = stringList(input.metadata?.assigneeIds)
  const previousSet = new Set(previous)
  const currentSet = new Set(current)
  const added = current.filter((id) => !previousSet.has(id))
  const removed = previous.filter((id) => !currentSet.has(id))
  const retained = current.filter((id) => previousSet.has(id))

  if (cancelled) {
    const recipients = [...new Set([...previous, ...current])]
    await queueEmail(input, {
      userIds: recipients,
      subject: `Diamond Shine · Visit cancelled · ${visit.site.name}`,
      eyebrow: 'Schedule change',
      title: 'Cleaning visit cancelled',
      message: `Operations cancelled the visit at ${visit.site.client.displayName} · ${visit.site.name}. It is no longer part of your active schedule.`,
      tone: 'danger',
      details: [
        ...visitDetails(visit),
        ...(visit.cancellationReason ? [{ label: 'Reason', value: visit.cancellationReason }] : []),
      ],
    }, 'visit', visit.id)
    return
  }

  if (added.length) {
    await queueEmail(input, {
      userIds: added,
      subject: `Diamond Shine · New visit assigned · ${visit.site.name}`,
      eyebrow: 'New assignment',
      title: 'You were added to a cleaning visit',
      message: `Operations added you to ${visit.site.client.displayName} · ${visit.site.name}. Review the latest details and confirm when Schedule asks for a response.`,
      tone: 'info',
      details: visitDetails(visit),
    }, 'visit', visit.id)
  }

  if (removed.length) {
    await queueEmail(input, {
      userIds: removed,
      subject: `Diamond Shine · Removed from visit · ${visit.site.name}`,
      eyebrow: 'Assignment changed',
      title: 'You were removed from a cleaning visit',
      message: `Operations removed you from the visit at ${visit.site.client.displayName} · ${visit.site.name}. The visit is no longer one of your active assignments.`,
      tone: 'warning',
      details: visitDetails(visit),
    }, 'visit', visit.id)
  }

  if (bool(input.metadata?.requiresNewAcknowledgement) && retained.length) {
    await queueEmail(input, {
      userIds: retained,
      subject: `Diamond Shine · Visit changed · please confirm · ${visit.site.name}`,
      eyebrow: 'Schedule changed',
      title: 'A confirmed visit changed',
      message: `Operations changed material details for ${visit.site.client.displayName} · ${visit.site.name}. Open Schedule, review the update and confirm again.`,
      tone: 'warning',
      details: [
        ...visitDetails(visit),
        ...(visit.dispatchNotes ? [{ label: 'Operations note', value: visit.dispatchNotes }] : []),
      ],
    }, 'visit', visit.id)
  }
}

async function queueServiceChange(input: AuditNotificationInput) {
  if (!input.targetId) return
  const effectiveFrom = text(input.metadata?.effectiveFrom)
  const effectiveDate = effectiveFrom ? new Date(effectiveFrom) : new Date()
  const newJob = await prisma.job.findFirst({
    where: { organizationId: input.organizationId, servicePlanId: input.targetId, archivedAt: null, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { site: { include: { client: { select: { displayName: true } } } } },
  })
  if (!newJob) return

  const [newAssignments, replacedAssignments] = await Promise.all([
    prisma.visitAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        visit: { jobId: newJob.id, scheduledStart: { gte: effectiveDate }, status: { notIn: ['cancelled', 'missed'] } },
      },
      select: { userId: true },
    }),
    prisma.visitAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        visit: {
          job: { servicePlanId: input.targetId },
          status: 'cancelled',
          scheduledStart: { gte: effectiveDate },
          cancellationReason: { startsWith: 'Service configuration replaced effective' },
        },
      },
      select: { userId: true },
    }),
  ])
  const newIds = [...new Set(newAssignments.map((assignment) => assignment.userId))]
  const oldIds = [...new Set(replacedAssignments.map((assignment) => assignment.userId))]
  const newSet = new Set(newIds)
  const removed = oldIds.filter((id) => !newSet.has(id))

  await queueEmail(input, {
    userIds: newIds,
    subject: `Diamond Shine · Cleaning schedule updated · ${newJob.site.name}`,
    eyebrow: 'Recurring schedule changed',
    title: 'Your recurring cleaning schedule changed',
    message: `Operations changed the service pattern for ${newJob.site.client.displayName} · ${newJob.site.name}. Review the new upcoming visits and confirm the updated schedule.`,
    tone: 'warning',
    details: [
      { label: 'Client', value: newJob.site.client.displayName },
      { label: 'Site', value: newJob.site.name },
      { label: 'Effective from', value: formatOperationalDateTime(effectiveDate, newJob.timezone) },
      { label: 'Expected visit duration', value: `${newJob.defaultDurationMin} min` },
    ],
  }, 'service_plan', input.targetId)

  await queueEmail(input, {
    userIds: removed,
    subject: `Diamond Shine · Removed from future recurring work · ${newJob.site.name}`,
    eyebrow: 'Assignment changed',
    title: 'You were removed from future recurring cleaning work',
    message: `The updated service pattern for ${newJob.site.client.displayName} · ${newJob.site.name} no longer assigns you to the future visits that were replaced.`,
    tone: 'warning',
    details: [
      { label: 'Client', value: newJob.site.client.displayName },
      { label: 'Site', value: newJob.site.name },
      { label: 'Effective from', value: formatOperationalDateTime(effectiveDate, newJob.timezone) },
    ],
  }, 'service_plan', input.targetId)
}

async function queueServicePause(input: AuditNotificationInput) {
  if (!input.targetId) return
  const pause = await prisma.servicePause.findFirst({
    where: { id: input.targetId, organizationId: input.organizationId },
    include: {
      client: { select: { displayName: true } },
      site: { include: { client: { select: { displayName: true } } } },
      job: { include: { site: { include: { client: { select: { displayName: true } } } } } },
    },
  })
  if (!pause) return
  const visitIds = stringList(input.metadata?.affectedVisits)
  const assignments = visitIds.length ? await prisma.visitAssignment.findMany({
    where: { organizationId: input.organizationId, visitId: { in: visitIds } },
    select: { userId: true },
  }) : []
  const userIds = [...new Set(assignments.map((assignment) => assignment.userId))]
  const target = pause.site
    ? `${pause.site.client.displayName} · ${pause.site.name}`
    : pause.job
      ? `${pause.job.site.client.displayName} · ${pause.job.name}`
      : pause.client?.displayName ?? 'Cleaning service'
  await queueEmail(input, {
    userIds,
    subject: `Diamond Shine · Service paused · ${target}`,
    eyebrow: 'Service pause',
    title: 'Scheduled cleaning work was paused',
    message: `${target} will not run during the pause window below. Affected visits were removed from the active schedule; check Schedule for your latest work.`,
    tone: 'warning',
    details: [
      { label: 'Service', value: target },
      { label: 'From', value: formatOperationalDateTime(pause.startsAt, pause.timezone) },
      { label: 'Until', value: formatOperationalDateTime(pause.endsAt, pause.timezone) },
      { label: 'Reason', value: pause.reason },
      { label: 'Affected scheduled visits', value: String(visitIds.length) },
    ],
  }, 'service_pause', pause.id)
}

async function queueVisitReview(input: AuditNotificationInput) {
  if (!input.targetId || !bool(input.metadata?.rework)) return
  const visit = await visitContext(input.organizationId, input.targetId)
  if (!visit) return
  const userIds = visit.assignments.map((assignment) => assignment.userId)
  const reviewId = text(input.metadata?.reviewId)
  const review = reviewId ? await prisma.visitReview.findFirst({ where: { id: reviewId, organizationId: input.organizationId } }) : null
  await queueEmail(input, {
    userIds,
    subject: `Diamond Shine · Rework requested · ${visit.site.name}`,
    eyebrow: 'Visit review',
    title: 'Operations reopened this visit',
    message: `The completed visit at ${visit.site.client.displayName} · ${visit.site.name} needs follow-up. Open the visit and review the Operations note before doing more work.`,
    tone: 'danger',
    details: [
      ...visitDetails(visit),
      ...(review?.note ? [{ label: 'Operations note', value: review.note }] : []),
    ],
  }, 'visit', visit.id)
}

async function queueUserRole(input: AuditNotificationInput) {
  if (!input.targetId) return
  const user = await prisma.user.findFirst({ where: { id: input.targetId, memberships: { some: { organizationId: input.organizationId } } }, select: { id: true, name: true, email: true } })
  if (!user) return
  const fromRole = text(input.metadata?.fromRole)
  const nextRole = text(input.metadata?.membershipRole)
  if (!nextRole || fromRole === nextRole) return
  await queueEmail(input, {
    userIds: [user.id],
    subject: 'Diamond Shine · Your access role changed',
    eyebrow: 'Account update',
    title: 'Operations changed your Diamond Shine role',
    message: 'Your permissions in Diamond Shine were updated by an administrator. Sign in again if the app asks you to refresh your access.',
    tone: 'info',
    details: [
      { label: 'Previous role', value: roleLabel(fromRole) },
      { label: 'New role', value: roleLabel(nextRole) },
    ],
  }, 'user', user.id)
}

async function queueUserStatus(input: AuditNotificationInput) {
  if (!input.targetId) return
  const user = await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, email: true } })
  if (!user) return
  const fromStatus = text(input.metadata?.fromStatus)
  const nextStatus = text(input.metadata?.status)
  if (!nextStatus || fromStatus === nextStatus) return
  await queueEmail(input, {
    userIds: [user.id],
    subject: `Diamond Shine · Account ${nextStatus === 'active' ? 'activated' : 'status changed'}`,
    eyebrow: 'Account update',
    title: nextStatus === 'active' ? 'Your Diamond Shine access is active' : 'Your Diamond Shine account status changed',
    message: nextStatus === 'active'
      ? 'Operations activated your Diamond Shine access.'
      : 'Operations changed the status of your Diamond Shine access. Contact Operations if you were not expecting this change.',
    tone: nextStatus === 'active' ? 'success' : 'warning',
    details: [
      { label: 'Previous status', value: statusLabel(fromStatus) },
      { label: 'New status', value: statusLabel(nextStatus) },
    ],
  }, 'user', user.id)
}

async function queueUserIdentity(input: AuditNotificationInput) {
  if (!input.targetId) return
  const user = await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, email: true } })
  if (!user) return
  const previousEmail = text(input.metadata?.previousEmail)
  const emailChanged = bool(input.metadata?.emailChanged)
  const nameChanged = bool(input.metadata?.nameChanged)
  if (!emailChanged && !nameChanged) return
  await queueEmail(input, {
    userIds: [user.id],
    recipientEmails: emailChanged && previousEmail ? [previousEmail] : undefined,
    subject: 'Diamond Shine · Your account details changed',
    eyebrow: 'Security & account',
    title: 'Operations updated your account details',
    message: 'An administrator changed identifying details on your Diamond Shine account. If you were not expecting this, contact Operations.',
    tone: 'warning',
    details: [
      ...(nameChanged ? [{ label: 'Name', value: user.name ?? user.email }] : []),
      ...(emailChanged ? [
        { label: 'Previous email', value: previousEmail },
        { label: 'New email', value: user.email },
      ] : []),
    ],
  }, 'user', user.id)
}

async function queueUserRemoved(input: AuditNotificationInput, invitationDeleted: boolean) {
  const email = text(input.metadata?.email)
  if (!email) return
  await queueEmail(input, {
    recipientEmails: [email],
    subject: invitationDeleted ? 'Diamond Shine · Invitation cancelled' : 'Diamond Shine · Organization access removed',
    eyebrow: 'Account update',
    title: invitationDeleted ? 'Your Diamond Shine invitation was cancelled' : 'Your Diamond Shine organization access was removed',
    message: invitationDeleted
      ? 'The pending invitation for this work email was cancelled by an administrator.'
      : 'An administrator removed your access to this Diamond Shine organization. Historical operational records remain preserved for company audit purposes.',
    tone: 'warning',
  }, 'user', input.targetId)
}

async function queueEmploymentSettings(input: AuditNotificationInput) {
  const userId = text(input.metadata?.userId)
  if (!userId) return
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } })
  if (!user) return
  const targetMinutes = number(input.metadata?.weeklyTargetMinutes)
  const startDate = text(input.metadata?.employmentStartDate)
  await queueEmail(input, {
    userIds: [user.id],
    subject: 'Diamond Shine · Employment settings updated',
    eyebrow: 'Workforce settings',
    title: 'Operations updated your employment settings',
    message: 'Your company-owned workforce settings were updated. These settings help Operations plan capacity; they do not automatically create worked time.',
    tone: 'info',
    details: [
      { label: 'Weekly target', value: targetMinutes ? `${Math.round(targetMinutes / 60 * 10) / 10} hours` : 'Not set' },
      ...(startDate ? [{ label: 'Employment start', value: startDate }] : []),
    ],
  }, 'workforce_profile', input.targetId)
}

async function queueInviteSetupComplete(input: AuditNotificationInput) {
  if (!input.targetId) return
  const user = await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, email: true } })
  if (!user) return
  const managers = await managementUserIds(input.organizationId, input.actorEmail)
  await queueEmail(input, {
    userIds: managers,
    subject: `Diamond Shine · Account setup completed · ${displayPerson(user)}`,
    eyebrow: 'Employee setup',
    title: 'Employee account setup is complete',
    message: `${displayPerson(user)} completed their secure profile and recurring availability setup. Company-owned employment settings may still need review before automatic staffing.`,
    tone: 'success',
    details: [
      { label: 'Employee', value: displayPerson(user) },
      { label: 'Study windows', value: String(number(input.metadata?.studyWindows)) },
      { label: 'Recurring unavailable windows', value: String(number(input.metadata?.recurringUnavailableWindows)) },
    ],
  }, 'user', user.id)
}

/**
 * Email only material changes that another person needs to know about or act on.
 * Routine clock events, normal visit completion and internal admin-only changes
 * intentionally stay out of email to keep Diamond Shine notifications useful.
 */
export async function queueAuditNotification(input: AuditNotificationInput) {
  switch (input.action) {
    // Employee -> Operations
    case 'visit_assignment_response': return queueVisitAssignmentResponse(input)
    case 'declare_unavailability': return queueAvailability(input, false)
    case 'cancel_unavailability': return queueAvailability(input, true)
    case 'create_time_entry_dispute': return queueTimeCorrectionRequest(input)
    case 'report_incident': return queueIncidentReported(input)
    case 'complete_invited_account_setup': return queueInviteSetupComplete(input)

    // Operations -> employee
    case 'create_manual_visit': return queueManualVisit(input)
    case 'create_job': return input.targetId ? queueJobAssignment(input, input.targetId) : undefined
    case 'create_client_service': {
      const jobId = text(input.metadata?.jobId)
      return jobId ? queueJobAssignment(input, jobId, 'New recurring cleaning service') : undefined
    }
    case 'change_client_service': return queueServiceChange(input)
    case 'update_visit': return queueVisitUpdate(input, false)
    case 'cancel_visit': return queueVisitUpdate(input, true)
    case 'create_service_pause': return queueServicePause(input)
    case 'resolve_time_entry_dispute': return queueTimeCorrectionResolution(input)
    case 'update_incident': return queueIncidentUpdate(input)
    case 'review_visit': return queueVisitReview(input)
    case 'update_user_role': return queueUserRole(input)
    case 'update_user_status': return queueUserStatus(input)
    case 'update_user_identity': return queueUserIdentity(input)
    case 'remove_user_from_organization': return queueUserRemoved(input, false)
    case 'delete_pending_invitation': return queueUserRemoved(input, true)
    case 'update_workforce_employment_settings': return queueEmploymentSettings(input)
    default: return undefined
  }
}
