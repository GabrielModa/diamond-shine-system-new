import { describe, expect, it } from 'vitest'
import { scopeScheduleHealthToEmployee, scopeScheduleHealthToUnassigned } from '../../src/modules/scheduling/schedule-health-scope'
import type { ScheduleHealthResult } from '../../src/modules/scheduling/schedule-health'

function baseResult(): ScheduleHealthResult {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-08T00:00:00.000Z',
    generatedAt: '2026-09-01T12:00:00.000Z',
    summary: {
      visits: 3,
      covered: 1,
      needsStaff: 1,
      unassigned: 1,
      missingSchedule: 1,
      unscheduledServices: 1,
      paused: 0,
      conflicts: 2,
      unacknowledged: 2,
      attention: 7,
    },
    items: [
      { id: 'coverage:a', state: 'needs_staff', clientName: 'A', visitId: 'visit-a', detail: '1/2' },
      { id: 'coverage:b', state: 'covered', clientName: 'B', visitId: 'visit-b', detail: '1/1' },
      { id: 'coverage:c', state: 'unassigned', clientName: 'C', visitId: 'visit-c', detail: '0/1' },
      { id: 'ack:a', state: 'acknowledgement_pending', clientName: 'A', visitId: 'visit-a', detail: 'pending' },
      { id: 'ack:b', state: 'acknowledgement_pending', clientName: 'B', visitId: 'visit-b', detail: 'pending' },
      { id: 'conflict:target', state: 'cleaner_overlap', clientName: 'A', visitId: 'visit-a', detail: 'double booked', conflict: { workerId: 'employee-1', workerName: 'Target', otherVisitId: 'visit-x', otherClientName: 'X', otherSiteName: 'X', otherJobName: 'X', otherScheduledStart: '2026-09-01T10:00:00.000Z', otherScheduledEnd: '2026-09-01T11:00:00.000Z', otherTimezone: 'Europe/Dublin', overlapMinutes: 30 } },
      { id: 'conflict:other', state: 'cleaner_overlap', clientName: 'B', visitId: 'visit-b', detail: 'double booked', conflict: { workerId: 'employee-2', workerName: 'Other', otherVisitId: 'visit-y', otherClientName: 'Y', otherSiteName: 'Y', otherJobName: 'Y', otherScheduledStart: '2026-09-01T10:00:00.000Z', otherScheduledEnd: '2026-09-01T11:00:00.000Z', otherTimezone: 'Europe/Dublin', overlapMinutes: 30 } },
      { id: 'missing', state: 'expected_not_scheduled', clientName: 'Global', detail: 'missing occurrence' },
      { id: 'plan', state: 'unscheduled_service', clientName: 'Global', detail: 'setup needed' },
    ],
  }
}

describe('employee schedule health scope', () => {
  it('unassigned scope excludes employee conflicts and global missing schedules', () => {
    const scoped = scopeScheduleHealthToUnassigned(baseResult())
    expect(scoped.items.map((item) => item.id)).toEqual(['coverage:c'])
    expect(scoped.summary).toMatchObject({ visits: 1, unassigned: 1, conflicts: 0, missingSchedule: 0, unacknowledged: 0 })
  })
  it('keeps only problems and coverage that belong to the selected employee', () => {
    const scoped = scopeScheduleHealthToEmployee(baseResult(), {
      employeeId: 'employee-1',
      activeVisitIds: ['visit-a', 'visit-b'],
      pendingAcknowledgementVisitIds: ['visit-a'],
    })

    expect(scoped.items.map((item) => item.id)).toEqual([
      'coverage:a',
      'coverage:b',
      'ack:a',
      'conflict:target',
    ])
    expect(scoped.summary).toMatchObject({
      visits: 2,
      covered: 1,
      needsStaff: 1,
      unassigned: 0,
      missingSchedule: 0,
      unscheduledServices: 0,
      conflicts: 1,
      unacknowledged: 1,
      attention: 3,
    })
  })

  it('does not count another cleaner pending acknowledgement on the same schedule view', () => {
    const scoped = scopeScheduleHealthToEmployee(baseResult(), {
      employeeId: 'employee-1',
      activeVisitIds: ['visit-a', 'visit-b'],
      pendingAcknowledgementVisitIds: [],
    })

    expect(scoped.summary.unacknowledged).toBe(0)
    expect(scoped.items.some((item) => item.state === 'acknowledgement_pending')).toBe(false)
  })
})
