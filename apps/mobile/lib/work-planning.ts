import { operationalDateKey } from './operational-time';

export type PlannableVisit = {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone?: string | null;
};

export type PlannedDay<T extends PlannableVisit> = {
  key: string;
  visits: T[];
  minutes: number;
};

export function visitMinutes(visit: Pick<PlannableVisit, 'scheduledStart' | 'scheduledEnd'>) {
  const start = new Date(visit.scheduledStart).getTime();
  const end = new Date(visit.scheduledEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

export function plannedMinutes(visits: readonly PlannableVisit[]) {
  return visits.reduce((total, visit) => total + visitMinutes(visit), 0);
}

export const plannedMinutesForVisits = plannedMinutes;

export function formatPlannedMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function groupVisitsByOperationalDay<T extends PlannableVisit>(visits: readonly T[], fallbackTimezone = 'Europe/Dublin') {
  const ordered = [...visits].sort((left, right) => new Date(left.scheduledStart).getTime() - new Date(right.scheduledStart).getTime());
  const groups = new Map<string, T[]>();

  for (const visit of ordered) {
    const key = operationalDateKey(visit.scheduledStart, visit.timezone ?? fallbackTimezone);
    const existing = groups.get(key);
    if (existing) existing.push(visit);
    else groups.set(key, [visit]);
  }

  return [...groups.entries()].map(([key, dayVisits]) => ({
    key,
    visits: dayVisits,
    minutes: plannedMinutes(dayVisits),
  })) satisfies PlannedDay<T>[];
}

export function groupVisitsByDay<T extends PlannableVisit>(visits: readonly T[], fallbackTimezone = 'Europe/Dublin') {
  return groupVisitsByOperationalDay(visits, fallbackTimezone).map((group) => ({
    ...group,
    plannedMinutes: group.minutes,
  }));
}

export function visitsStartingWithinDays<T extends PlannableVisit>(visits: readonly T[], days: number, now = new Date()) {
  const start = now.getTime();
  const end = start + Math.max(0, days) * 86_400_000;
  return visits.filter((visit) => {
    const scheduled = new Date(visit.scheduledStart).getTime();
    return Number.isFinite(scheduled) && scheduled >= start && scheduled < end;
  });
}

export function sevenDayWindowVisits<T extends PlannableVisit>(visits: readonly T[], now = new Date(), _fallbackTimezone = 'Europe/Dublin') {
  return visitsStartingWithinDays(visits, 7, now);
}
