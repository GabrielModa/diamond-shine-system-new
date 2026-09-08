import { describe, expect, it } from 'vitest';
import { groupVisitsByOperationalDay, plannedMinutes, visitsStartingWithinDays } from '../../apps/mobile/lib/work-planning';

const baseVisit = {
  timezone: 'Europe/Dublin',
};

describe('mobile work planning', () => {
  it('groups visits by operational day and totals planned minutes', () => {
    const visits = [
      { ...baseVisit, id: 'b', scheduledStart: '2026-09-08T18:31:00.000Z', scheduledEnd: '2026-09-08T20:31:00.000Z' },
      { ...baseVisit, id: 'a', scheduledStart: '2026-09-08T16:30:00.000Z', scheduledEnd: '2026-09-08T18:30:00.000Z' },
      { ...baseVisit, id: 'c', scheduledStart: '2026-09-10T16:30:00.000Z', scheduledEnd: '2026-09-10T18:30:00.000Z' },
    ];

    const groups = groupVisitsByOperationalDay(visits);

    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe('2026-09-08');
    expect(groups[0].minutes).toBe(240);
    expect(groups[0].visits.map((visit) => visit.id)).toEqual(['a', 'b']);
    expect(groups[1].key).toBe('2026-09-10');
    expect(groups[1].minutes).toBe(120);
  });

  it('ignores negative or invalid durations', () => {
    expect(plannedMinutes([
      { id: 'negative', scheduledStart: '2026-09-08T19:00:00.000Z', scheduledEnd: '2026-09-08T18:00:00.000Z' },
      { id: 'invalid', scheduledStart: 'bad', scheduledEnd: 'also-bad' },
    ])).toBe(0);
  });

  it('returns only visits starting inside the requested planning horizon', () => {
    const now = new Date('2026-09-08T12:00:00.000Z');
    const visits = [
      { id: 'soon', scheduledStart: '2026-09-09T12:00:00.000Z', scheduledEnd: '2026-09-09T13:00:00.000Z' },
      { id: 'later', scheduledStart: '2026-09-16T12:00:00.000Z', scheduledEnd: '2026-09-16T13:00:00.000Z' },
      { id: 'past', scheduledStart: '2026-09-08T11:00:00.000Z', scheduledEnd: '2026-09-08T12:00:00.000Z' },
    ];

    expect(visitsStartingWithinDays(visits, 7, now).map((visit) => visit.id)).toEqual(['soon']);
  });
});
