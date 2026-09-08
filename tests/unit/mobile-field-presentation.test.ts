import { describe, expect, it } from 'vitest';
import { entrySeconds, entrySecondsOnOperationalDay, fieldVisitState, fieldVisitStatusText, formatMinutes, minutesBetween } from '../../apps/mobile/lib/field-presentation';
import type { TimeEntry, Visit } from '../../apps/mobile/lib/types';

type AssignmentStatus = NonNullable<Visit['assignments']>[number]['status'];

function visit(status: string, assignmentStatus: AssignmentStatus = 'assigned', timeEntries: TimeEntry[] = []): Visit {
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
    timeEntries,
  };
}

describe('field presentation helpers', () => {
  it('uses employee-specific field states instead of the global visit status', () => {
    const teammateRunning: TimeEntry = {
      id: 'team-running', kind: 'visit', status: 'running', startedAt: '2026-09-08T17:00:00.000Z',
      user: { id: 'user-2', email: 'maria@example.com' },
    };
    const ownRunning: TimeEntry = {
      id: 'own-running', kind: 'visit', status: 'running', startedAt: '2026-09-08T17:00:00.000Z',
      user: { id: 'user-1', email: 'gabriel@example.com' },
    };
    const ownFinished: TimeEntry = {
      id: 'own-finished', kind: 'visit', status: 'completed', startedAt: '2026-09-08T16:30:00.000Z', endedAt: '2026-09-08T18:00:00.000Z',
      user: { id: 'user-1', email: 'gabriel@example.com' },
    };
    const ownBreak: TimeEntry = {
      id: 'own-break', kind: 'break', status: 'running', startedAt: '2026-09-08T17:30:00.000Z',
      user: { id: 'user-1', email: 'gabriel@example.com' },
    };

    expect(fieldVisitState(visit('scheduled', 'acknowledged'), 'gabriel@example.com').label).toBe('Confirmed');
    expect(fieldVisitState(visit('scheduled', 'seen'), 'gabriel@example.com').label).toBe('Needs confirmation');
    expect(fieldVisitState(visit('in_progress', 'acknowledged', [teammateRunning]), 'gabriel@example.com').label).toBe('Confirmed');
    expect(fieldVisitState(visit('in_progress', 'acknowledged', [ownRunning]), 'gabriel@example.com').label).toBe('In progress');
    expect(fieldVisitState(visit('in_progress', 'acknowledged', [ownFinished]), 'gabriel@example.com').label).toBe('Finish visit');
    expect(fieldVisitState(visit('in_progress', 'acknowledged', [ownBreak]), 'gabriel@example.com').label).toBe('Paused');
    expect(fieldVisitState(visit('completed', 'acknowledged'), 'gabriel@example.com').label).toBe('Done');
    expect(fieldVisitStatusText(visit('acknowledged', 'acknowledged'), 'gabriel@example.com')).toBe('Confirmed');
  });

  it('formats planned time for field summaries', () => {
    expect(minutesBetween('2026-09-08T16:30:00.000Z', '2026-09-08T18:30:00.000Z')).toBe(120);
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(150)).toBe('2h 30m');
  });

  it('counts running entries against the supplied clock', () => {
    expect(entrySeconds({ id: 't1', kind: 'visit', status: 'running', startedAt: '2026-09-08T18:00:00.000Z' }, Date.parse('2026-09-08T18:30:00.000Z'))).toBe(1800);
  });

  it('splits overnight work across operational days instead of assigning it all to the start date', () => {
    const overnight: TimeEntry = {
      id: 'overnight', kind: 'visit', status: 'completed',
      startedAt: '2026-09-08T22:00:00.000Z',
      endedAt: '2026-09-09T00:30:00.000Z',
    };
    expect(entrySecondsOnOperationalDay(overnight, '2026-09-08T12:00:00.000Z', 'Europe/Dublin')).toBe(3600);
    expect(entrySecondsOnOperationalDay(overnight, '2026-09-09T12:00:00.000Z', 'Europe/Dublin')).toBe(5400);
  });
});
