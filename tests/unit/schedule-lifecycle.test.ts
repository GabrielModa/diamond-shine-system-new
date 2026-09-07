import { describe, expect, it } from 'vitest'
import { employeeScheduleHours, matchesScheduleLifecycleFilter, scheduleLifecycleLabel } from '../../src/components/schedule/schedule-lifecycle'

const assignment = (userId: string, status = 'acknowledged') => ({ status, user: { id: userId } })
const visit = (status: string, assignments = [assignment('employee-1')], timeEntries: Array<{ userId: string; kind: string; status: string; durationSeconds?: number | null }> = []) => ({
  status,
  scheduledStart: '2026-09-07T17:00:00.000Z',
  scheduledEnd: '2026-09-07T19:00:00.000Z',
  assignments,
  timeEntries,
})

describe('schedule lifecycle UX', () => {
  it('maps operational visit states to Booked, Confirmed and live execution without inventing a separate now filter', () => {
    expect(matchesScheduleLifecycleFilter('scheduled', 'booked')).toBe(true)
    expect(matchesScheduleLifecycleFilter('dispatched', 'booked')).toBe(true)
    expect(matchesScheduleLifecycleFilter('acknowledged', 'confirmed')).toBe(true)
    expect(matchesScheduleLifecycleFilter('in_progress', 'confirmed')).toBe(true)
    expect(matchesScheduleLifecycleFilter('completion_blocked', 'confirmed')).toBe(true)
    expect(scheduleLifecycleLabel('in_progress')).toBe('In progress now')
  })

  it('keeps completed work separate from cancelled or missed history', () => {
    expect(matchesScheduleLifecycleFilter('completed', 'done')).toBe(true)
    expect(matchesScheduleLifecycleFilter('completed', 'history')).toBe(false)
    expect(matchesScheduleLifecycleFilter('cancelled', 'history')).toBe(true)
    expect(matchesScheduleLifecycleFilter('missed', 'history')).toBe(true)
  })

  it('uses planned time for future commitment and recorded visit time for completed employee work', () => {
    const summary = employeeScheduleHours([
      visit('dispatched'),
      visit('acknowledged'),
      visit('in_progress'),
      visit('completed', [assignment('employee-1')], [
        { userId: 'employee-1', kind: 'visit', status: 'completed', durationSeconds: 5_400 },
        { userId: 'employee-2', kind: 'visit', status: 'completed', durationSeconds: 7_200 },
        { userId: 'employee-1', kind: 'driving', status: 'completed', durationSeconds: 1_800 },
      ]),
    ], 'employee-1')

    expect(summary).toEqual({ bookedMinutes: 120, confirmedMinutes: 240, doneMinutes: 90 })
  })
})
