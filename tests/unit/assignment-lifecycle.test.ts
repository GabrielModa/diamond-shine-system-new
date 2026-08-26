import { describe, expect, it } from 'vitest'
import { activeAssignmentCount, isActiveAssignmentStatus, isOperationalVisitStatus } from '../../src/modules/scheduling/assignment-lifecycle'

describe('assignment lifecycle', () => {
  it('treats declined and removed assignments as non-operational', () => {
    expect(isActiveAssignmentStatus('assigned')).toBe(true); expect(isActiveAssignmentStatus('acknowledged')).toBe(true); expect(isActiveAssignmentStatus('declined')).toBe(false); expect(isActiveAssignmentStatus('removed')).toBe(false)
    expect(activeAssignmentCount([{ status: 'assigned' }, { status: 'declined' }, { status: 'removed' }, { status: 'seen' }])).toBe(2)
  })
  it('treats cancelled and missed visits as non-operational', () => { expect(isOperationalVisitStatus('scheduled')).toBe(true); expect(isOperationalVisitStatus('cancelled')).toBe(false); expect(isOperationalVisitStatus('missed')).toBe(false) })
})
