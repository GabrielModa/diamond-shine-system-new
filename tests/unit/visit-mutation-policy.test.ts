import { describe, expect, it } from 'vitest'
import { visitMutationRequiresNewAcknowledgement } from '../../src/modules/scheduling/visit-mutation-policy'

const base = {
  scheduledStart: new Date('2026-09-01T07:00:00.000Z'),
  scheduledEnd: new Date('2026-09-01T10:00:00.000Z'),
  dispatchNotes: null,
  assigneeIds: ['a', 'b'],
}

describe('visitMutationRequiresNewAcknowledgement', () => {
  it('does not invalidate acknowledgement for a true no-op save', () => {
    expect(visitMutationRequiresNewAcknowledgement(base, { ...base, assigneeIds: ['b', 'a'] })).toBe(false)
  })

  it('invalidates acknowledgement when the time changes', () => {
    expect(visitMutationRequiresNewAcknowledgement(base, {
      ...base,
      scheduledStart: new Date('2026-09-01T08:00:00.000Z'),
      scheduledEnd: new Date('2026-09-01T11:00:00.000Z'),
    })).toBe(true)
  })

  it('invalidates acknowledgement when the team changes', () => {
    expect(visitMutationRequiresNewAcknowledgement(base, { ...base, assigneeIds: ['a', 'c'] })).toBe(true)
  })

  it('invalidates acknowledgement when dispatch instructions change', () => {
    expect(visitMutationRequiresNewAcknowledgement(base, { ...base, dispatchNotes: 'Use loading bay entrance' })).toBe(true)
  })

  it('treats whitespace-only note differences as the same instruction', () => {
    expect(visitMutationRequiresNewAcknowledgement({ ...base, dispatchNotes: '  ' }, { ...base, dispatchNotes: null })).toBe(false)
  })
})
