import type { TimeEntry, Visit } from './types';

export type FieldVisitState = {
  label: 'Needs confirmation' | 'Confirmed' | 'In progress' | 'Done' | 'Cancelled' | 'Missed' | 'Upcoming';
  tone: 'attention' | 'confirmed' | 'live' | 'done' | 'muted';
};

const PENDING_ASSIGNMENTS = new Set(['assigned', 'notified', 'seen']);

export function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

export function entrySeconds(entry: TimeEntry, nowMs = Date.now()) {
  if (entry.durationSeconds != null) return Math.max(0, entry.durationSeconds);
  const endMs = entry.endedAt ? new Date(entry.endedAt).getTime() : nowMs;
  return Math.max(0, Math.round((endMs - new Date(entry.startedAt).getTime()) / 1000));
}

export function ownVisitEntries(visits: Visit[], email?: string | null) {
  const normalized = email?.toLowerCase();
  if (!normalized) return [];
  return visits.flatMap((visit) => (visit.timeEntries ?? [])
    .filter((entry) => entry.kind === 'visit' && entry.user?.email.toLowerCase() === normalized)
    .map((entry) => ({ ...entry, visit })));
}

export function ownAssignmentStatus(visit: Visit, email?: string | null) {
  const normalized = email?.toLowerCase();
  return visit.assignments?.find((assignment) => assignment.user.email.toLowerCase() === normalized)?.status;
}

export function fieldVisitState(visit: Visit, email?: string | null): FieldVisitState {
  if (visit.status === 'completed') return { label: 'Done', tone: 'done' };
  if (visit.status === 'cancelled') return { label: 'Cancelled', tone: 'muted' };
  if (visit.status === 'missed') return { label: 'Missed', tone: 'attention' };
  if (visit.status === 'in_progress' || visit.status === 'completion_blocked') return { label: 'In progress', tone: 'live' };

  const assignment = ownAssignmentStatus(visit, email);
  if (assignment === 'acknowledged') return { label: 'Confirmed', tone: 'confirmed' };
  if (assignment && PENDING_ASSIGNMENTS.has(assignment)) return { label: 'Needs confirmation', tone: 'attention' };
  return { label: 'Upcoming', tone: 'muted' };
}
