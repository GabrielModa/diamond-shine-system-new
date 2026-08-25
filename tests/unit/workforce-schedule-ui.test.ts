import { describe, expect, it } from 'vitest'
import { currentSchoolWindow, minutesToClock, schoolScheduleSummary } from '../../src/lib/workforce-schedule-ui'

describe('workforce school schedule presentation', () => {
  it('formats grouped schedule windows for the manager UI', () => {
    expect(schoolScheduleSummary([
      { dayOfWeek:1, startsMinute:540, endsMinute:840 },
      { dayOfWeek:2, startsMinute:540, endsMinute:840 },
      { dayOfWeek:4, startsMinute:840, endsMinute:1080 },
    ])).toContain('Mon, Tue · 09:00–14:00')
    expect(minutesToClock(1080)).toBe('18:00')
  })

  it('detects the active school window using the organization timezone', () => {
    const result = currentSchoolWindow(
      [{ dayOfWeek:2, startsMinute:0, endsMinute:1440 }],
      new Date('2026-08-25T12:00:00Z'),
      'Europe/Dublin',
    )
    expect(result.active).not.toBeNull()
    expect(result.active?.endsMinute).toBe(1440)
  })
})
