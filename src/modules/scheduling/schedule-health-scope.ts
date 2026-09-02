import type { ScheduleHealthResult } from './schedule-health'
import type { ScheduleHealthItem, ScheduleHealthSummary } from './schedule-health-core'

export type EmployeeScheduleHealthScope = {
  employeeId: string
  activeVisitIds: Iterable<string>
  pendingAcknowledgementVisitIds: Iterable<string>
}

function scopedItem(
  item: ScheduleHealthItem,
  employeeId: string,
  activeVisitIds: Set<string>,
  pendingAcknowledgementVisitIds: Set<string>,
) {
  if (item.state === 'cleaner_overlap') return item.conflict?.workerId === employeeId
  if (item.state === 'acknowledgement_pending') {
    return Boolean(item.visitId && pendingAcknowledgementVisitIds.has(item.visitId))
  }
  if (item.state === 'covered' || item.state === 'needs_staff' || item.state === 'unassigned') {
    return Boolean(item.visitId && activeVisitIds.has(item.visitId))
  }
  return false
}

function summaryFor(items: ScheduleHealthItem[]): ScheduleHealthSummary {
  const summary: ScheduleHealthSummary = {
    visits: 0,
    covered: 0,
    needsStaff: 0,
    unassigned: 0,
    missingSchedule: 0,
    unscheduledServices: 0,
    paused: 0,
    conflicts: 0,
    unacknowledged: 0,
    attention: 0,
  }

  for (const item of items) {
    if (item.state === 'covered') { summary.visits += 1; summary.covered += 1 }
    else if (item.state === 'needs_staff') { summary.visits += 1; summary.needsStaff += 1 }
    else if (item.state === 'unassigned') { summary.visits += 1; summary.unassigned += 1 }
    else if (item.state === 'cleaner_overlap') summary.conflicts += 1
    else if (item.state === 'acknowledgement_pending') summary.unacknowledged += 1
  }

  summary.attention = summary.needsStaff + summary.unassigned + summary.conflicts + summary.unacknowledged
  return summary
}

export function scopeScheduleHealthToEmployee(
  result: ScheduleHealthResult,
  scope: EmployeeScheduleHealthScope,
): ScheduleHealthResult {
  const activeVisitIds = new Set(scope.activeVisitIds)
  const pendingAcknowledgementVisitIds = new Set(scope.pendingAcknowledgementVisitIds)
  const items = result.items.filter((item) => scopedItem(item, scope.employeeId, activeVisitIds, pendingAcknowledgementVisitIds))

  return {
    ...result,
    summary: summaryFor(items),
    items,
  }
}

export function scopeScheduleHealthToUnassigned(result: ScheduleHealthResult): ScheduleHealthResult {
  const items = result.items.filter((item) => item.state === 'unassigned')
  return { ...result, items, summary: summaryFor(items) }
}
