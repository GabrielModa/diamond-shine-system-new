import { describe, expect, it } from 'vitest'
import { assignedVisitFilter } from '../../src/modules/execution/access'

describe('field execution access', () => {
  it.each(['employee', 'field_supervisor', 'organization_admin'] as const)(
    'limits %s execution to their active assignments',
    (membershipRole) => {
      const where = assignedVisitFilter({ id: 'user-1', membershipRole } as never)

      expect(where).toMatchObject({
        status: { notIn: ['cancelled', 'completed', 'missed'] },
        assignments: { some: { userId: 'user-1', status: { in: ['assigned', 'notified', 'seen', 'acknowledged'] } } },
      })
    },
  )
})
