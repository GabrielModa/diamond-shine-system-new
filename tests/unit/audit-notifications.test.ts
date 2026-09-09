import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  membershipFindMany: vi.fn(),
  assignmentFindFirst: vi.fn(),
  visitFindFirst: vi.fn(),
}))

vi.mock('../../src/lib/notification-queue', () => ({ enqueueNotification: mocks.enqueue }))
vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    membership: { findMany: mocks.membershipFindMany },
    visitAssignment: { findFirst: mocks.assignmentFindFirst },
    visit: { findFirst: mocks.visitFindFirst },
  },
}))

import { queueAuditNotification } from '../../src/lib/audit-notifications'

const organizationId = 'org-test'

function visit() {
  return {
    id: 'visit-1',
    organizationId,
    scheduledStart: new Date('2026-09-10T16:30:00.000Z'),
    scheduledEnd: new Date('2026-09-10T18:30:00.000Z'),
    timezone: 'Europe/Dublin',
    status: 'scheduled',
    cancellationReason: null,
    dispatchNotes: null,
    site: {
      id: 'site-1',
      name: 'The Academy',
      client: { displayName: 'EPAM' },
    },
    job: { id: 'job-1', name: 'Evening cleaning' },
    assignments: [
      { id: 'a-old', userId: 'employee-old', status: 'removed', user: { id: 'employee-old', name: 'Old Cleaner', email: 'old@ds.ie' } },
      { id: 'a-new', userId: 'employee-new', status: 'assigned', user: { id: 'employee-new', name: 'New Cleaner', email: 'new@ds.ie' } },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('audit operational notifications', () => {
  it('routes an employee schedule confirmation to active management recipients', async () => {
    mocks.assignmentFindFirst.mockResolvedValue({
      id: 'assignment-1',
      organizationId,
      status: 'acknowledged',
      declineReason: null,
      user: { name: 'Employee', email: 'employee@ds.ie' },
      visit: {
        scheduledStart: new Date('2026-09-10T16:30:00.000Z'),
        timezone: 'Europe/Dublin',
        site: { name: 'The Academy', client: { displayName: 'EPAM' } },
        job: { name: 'Evening cleaning' },
      },
    })
    mocks.membershipFindMany.mockResolvedValue([
      { userId: 'admin-1', user: { email: 'admin@ds.ie' } },
      { userId: 'scheduler-1', user: { email: 'scheduler@ds.ie' } },
    ])

    await queueAuditNotification({
      actorEmail: 'employee@ds.ie',
      action: 'visit_assignment_response',
      targetType: 'visit_assignment',
      targetId: 'assignment-1',
      organizationId,
      metadata: { status: 'acknowledged', scope: 'recurring', affectedVisits: 8 },
    })

    expect(mocks.enqueue).toHaveBeenCalledTimes(1)
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'operational_email',
      organizationId,
      createdBy: 'employee@ds.ie',
      payload: expect.objectContaining({
        userIds: ['admin-1', 'scheduler-1'],
        tone: 'success',
        title: 'Cleaning schedule confirmed',
        action: { label: 'Review schedule', path: '/schedule' },
      }),
    }))
  })

  it('emails both sides of an admin reassignment without notifying unrelated employees', async () => {
    mocks.visitFindFirst.mockResolvedValue(visit())

    await queueAuditNotification({
      actorEmail: 'admin@ds.ie',
      action: 'update_visit',
      targetType: 'visit',
      targetId: 'visit-1',
      organizationId,
      metadata: {
        previousAssigneeIds: ['employee-old'],
        assigneeIds: ['employee-new'],
        requiresNewAcknowledgement: true,
      },
    })

    expect(mocks.enqueue).toHaveBeenCalledTimes(2)
    expect(mocks.enqueue.mock.calls.map(([job]) => job.payload.userIds)).toEqual([
      ['employee-new'],
      ['employee-old'],
    ])
    expect(mocks.enqueue.mock.calls.map(([job]) => job.payload.title)).toEqual([
      'You were added to a cleaning visit',
      'You were removed from a cleaning visit',
    ])
    expect(mocks.enqueue.mock.calls.map(([job]) => job.payload.action)).toEqual([
      { label: 'Review visit', path: '/schedule?visit=visit-1' },
      { label: 'Review visit', path: '/schedule?visit=visit-1' },
    ])
  })

  it('keeps routine timer audit noise out of email', async () => {
    await queueAuditNotification({
      actorEmail: 'employee@ds.ie',
      action: 'start_time_entry',
      targetType: 'time_entry',
      targetId: 'time-1',
      organizationId,
    })

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})
