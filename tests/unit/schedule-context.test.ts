import { describe, expect, it } from 'vitest'
import { readScheduleContext, writeScheduleContext } from '../../src/components/schedule/schedule-context'
import { calendarDateKey } from '../../src/lib/operational-time'

const fallback = new Date(2026, 8, 2, 12)
describe('Schedule URL context', () => {
  it('restores employee, view and date without a one-shot state guard', () => {
    for (const team of ['employee-a', 'employee-b', 'all', 'unassigned']) {
      const query = writeScheduleContext(new URLSearchParams('visit=visit-1'), { team, view: 'day', date: fallback })
      expect(readScheduleContext(query, 'Europe/Dublin', fallback)).toMatchObject({ team, view: 'day' })
      expect(query.get('visit')).toBe('visit-1')
      expect(query.has('employee')).toBe(!['all', 'unassigned'].includes(team))
    }
  })
  it.each(['2026-03-29', '2026-10-25'])('treats date-only %s as a calendar day, not a UTC instant', (date) => {
    const context = readScheduleContext(new URLSearchParams({ date }), 'America/Los_Angeles', fallback)
    expect(calendarDateKey(context.date)).toBe(date)
  })
  it('converts timestamp deep links into the Dublin calendar day', () => {
    const context = readScheduleContext(new URLSearchParams({ date: '2026-09-01T23:30:00Z' }), 'Europe/Dublin', fallback)
    expect(calendarDateKey(context.date)).toBe('2026-09-02')
  })
  it('rejects invalid calendar dates and unknown view values', () => {
    const context = readScheduleContext(new URLSearchParams('date=2026-02-31&view=nonsense'), 'Europe/Dublin', fallback)
    expect(context.date).toBe(fallback)
    expect(context.view).toBe('week')
  })
})
