import { describe, expect, it } from 'vitest';
import { entrySeconds, fieldVisitState, formatMinutes, minutesBetween } from '../../apps/mobile/lib/field-presentation';
import type { Visit } from '../../apps/mobile/lib/types';

type AssignmentStatus = NonNullable<Visit['assignments']>[number]['status'];

function visit(status: string, assignmentStatus: AssignmentStatus = 'assigned'): Visit {
  return {
    id: 'visit-1',
    status,
    scheduledStart: '2026-09-08T16:30:00.000Z',
    scheduledEnd: '2026-09-08T18:30:00.000Z',
    site: {
      id: 'site-1', name: 'The Academy', addressLine1: '42 Pearse Street', city: 'Dublin',
      client: { id: 'client-1', displayName: 'EPAM Systems' },
    },
    assignments: [{ id: 'assignment-1', status: assignmentStatus, user: { id: 'user-1', email: 'gabriel@example.com' } }],
  };
}

describe('field presentation helpers', () => {
  it('uses simple employee-facing schedule labels', () => {
    expect(fieldVisitState(visit('scheduled', 'acknowledged'), 'gabriel@example.com').label).toBe('Confirmed');
    expect(fieldVisitState(visit('scheduled', 'seen'), 'gabriel@example.com').label).toBe('Needs confirmation');
    expect(fieldVisitState(visit('in_progress', 'acknowledged'), 'gabriel@example.com').label).toBe('In progress');
    expect(fieldVisitState(visit('completed', 'acknowledged'), 'gabriel@example.com').label).toBe('Done');
  });

  it('formats planned time for field summaries', () => {
    expect(minutesBetween('2026-09-08T16:30:00.000Z', '2026-09-08T18:30:00.000Z')).toBe(120);
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(150)).toBe('2h 30m');
  });

  it('counts running entries against the supplied clock', () => {
    expect(entrySeconds({ id: 't1', kind: 'visit', status: 'running', startedAt: '2026-09-08T18:00:00.000Z' }, Date.parse('2026-09-08T18:30:00.000Z'))).toBe(1800);
  });
});
