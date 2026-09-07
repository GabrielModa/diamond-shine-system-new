import { describe, expect, it } from 'vitest'
import { plannedMinutes, scheduleLifecycleBucket } from '../../src/components/schedule/schedule-lifecycle'

function visit(status: string, assignmentStatus = 'assigned', requiredWorkers = 1) {
  return {
    status,
    scheduledStart: '2026-09-07T17:00:00.000Z',
    scheduledEnd: '2026-09-07T19:00:00.000Z',
    requiredWorkers,
    assignments: [{ status: assignmentStatus, user: { id: 'employee-1' } }],
  }
}

describe('schedule lifecycle semantics', () => {
  it('separates booked work from employee-confirmed work', () => {
    expect(scheduleLifecycleBucket(visit('dispatched', 'seen'), 'employee-1')).toBe('booked')
    expect(scheduleLifecycleBucket(visit('acknowledged', 'acknowledged'), 'employee-1')).toBe('confirmed')
  })

  it('keeps active execution in confirmed while exposing it as a live visit status', () => {
    expect(scheduleLifecycleBucket(visit('in_progress', 'assigned'), 'employee-1')).toBe('confirmed')
  })

  it('separates completed from cancelled or missed history', () => {
    expect(scheduleLifecycleBucket(visit('completed', 'acknowledged'))).toBe('done')
    expect(scheduleLifecycleBucket(visit('cancelled', 'assigned'))).toBe('history')
    expect(scheduleLifecycleBucket(visit('missed', 'assigned'))).toBe('history')
  })

  it('uses complete team acknowledgement for the all-team confirmed view', () => {
    const partial = {
      ...visit('dispatched', 'acknowledged', 2),
      assignments: [
        { status: 'acknowledged', user: { id: 'employee-1' } },
        { status: 'seen', user: { id: 'employee-2' } },
      ],
    }
    expect(scheduleLifecycleBucket(partial)).toBe('booked')
    expect(scheduleLifecycleBucket({ ...partial, assignments: partial.assignments.map((assignment) => ({ ...assignment, status: 'acknowledged' })) })).toBe('confirmed')
  })

  it('calculates planned shift minutes from the scheduled window', () => {
    expect(plannedMinutes(visit('dispatched'))).toBe(120)
  })
})
