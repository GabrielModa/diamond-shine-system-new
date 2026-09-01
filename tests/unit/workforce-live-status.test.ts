import { describe, expect, it } from 'vitest'
import { resolveWorkforceLiveStatus } from '../../src/modules/workforce/live-status'

const now = new Date('2026-09-01T20:00:00.000Z')
const visit = {
  id: 'visit-1',
  scheduledStart: new Date('2026-09-01T19:30:00.000Z'),
  scheduledEnd: new Date('2026-09-01T21:30:00.000Z'),
}

describe('workforce live status', () => {
  it('keeps an active timer on job while surfacing stale-signal attention separately', () => {
    expect(resolveWorkforceLiveStatus({
      now,
      contextState: 'home',
      runningEntry: {
        startedAt: new Date('2026-09-01T19:35:00.000Z'),
        lastSignalAt: new Date('2026-09-01T19:45:00.000Z'),
        locationClassification: 'verified',
      },
      currentVisit: visit,
    })).toMatchObject({ state: 'on_job', signalState: 'stale', attention: true })
  })

  it('flags a started visit without clock-in after the grace window', () => {
    expect(resolveWorkforceLiveStatus({
      now,
      contextState: 'home',
      currentVisit: visit,
    })).toMatchObject({ state: 'attention', signalState: 'missing', attention: true })
  })

  it('uses expected school only when no active operational visit takes precedence', () => {
    expect(resolveWorkforceLiveStatus({ now, contextState: 'school' })).toMatchObject({
      state: 'expected_school',
      attention: false,
    })
  })

  it('marks a near-future visit as starting soon', () => {
    expect(resolveWorkforceLiveStatus({
      now,
      contextState: 'home',
      nextVisit: {
        id: 'visit-2',
        scheduledStart: new Date('2026-09-01T20:20:00.000Z'),
        scheduledEnd: new Date('2026-09-01T22:00:00.000Z'),
      },
    })).toMatchObject({ state: 'starting_soon', attention: false })
  })

  it('keeps personal leave off the live operational map', () => {
    expect(resolveWorkforceLiveStatus({ now, contextState: 'personal_leave' })).toMatchObject({
      state: 'unavailable',
      attention: false,
    })
  })
})
