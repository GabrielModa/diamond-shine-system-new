import { describe, expect, it } from 'vitest'
import { coverageState, intervalsOverlap, sortScheduleHealthItems, type ScheduleHealthItem } from '../../src/modules/scheduling/schedule-health-core'

describe('schedule health domain', () => {
  it('treats partial coverage as an operational gap', () => {
    expect(coverageState(0, 2)).toBe('unassigned')
    expect(coverageState(1, 2)).toBe('needs_staff')
    expect(coverageState(2, 2)).toBe('covered')
    expect(coverageState(3, 2)).toBe('covered')
  })

  it('only calls time windows overlapping when the windows actually intersect', () => {
    const nine = new Date('2026-08-24T09:00:00.000Z')
    const ten = new Date('2026-08-24T10:00:00.000Z')
    const eleven = new Date('2026-08-24T11:00:00.000Z')
    expect(intervalsOverlap(nine, ten, ten, eleven)).toBe(false)
    expect(intervalsOverlap(nine, eleven, ten, new Date('2026-08-24T12:00:00.000Z'))).toBe(true)
  })

  it('sorts missing obligations and cleaner overlaps ahead of healthy visits', () => {
    const base = { clientName: 'Client', detail: 'x' }
    const rows: ScheduleHealthItem[] = [
      { ...base, id: 'covered', state: 'covered' },
      { ...base, id: 'staff', state: 'needs_staff' },
      { ...base, id: 'missing', state: 'expected_not_scheduled' },
    ]
    expect(rows.sort(sortScheduleHealthItems).map((item) => item.id)).toEqual(['missing', 'staff', 'covered'])
  })
})
