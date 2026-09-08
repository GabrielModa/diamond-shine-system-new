import { Platform } from 'react-native';
import { addOperationalDays, formatOperationalTime, operationalDateKey, zonedDateTimeToUtc } from './operational-time';
import type { Session, TimeEntry, Visit } from './types';
import type { WorkCommitment } from './use-work-commitments';

type NotificationsModule = typeof import('expo-notifications');

type ReminderTone = 'primary' | 'warning' | 'danger' | 'accent' | 'ink';

type PlannedReminder = {
  date: Date;
  title: string;
  body: string;
  type: 'work_progress' | 'visit_reminder' | 'day_summary' | 'schedule_confirmation';
  visitId?: string;
  milestone?: 'half' | '30m' | '5m';
  channelId: 'work-progress' | 'work-warning' | 'visit-reminders' | 'schedule-confirmation';
  tone: ReminderTone;
};

const FIELD_SOURCE = 'diamond_shine_field';
const COLORS: Record<ReminderTone, string> = {
  primary: '#0F7A55',
  warning: '#E67E22',
  danger: '#C0392B',
  accent: '#6C5CE7',
  ink: '#102A43',
};

let channelsConfigured = false;
let lastFingerprint = '';
let reconcileInFlight: Promise<void> | null = null;
let workReconcileInFlight: Promise<void> | null = null;

async function notifications() {
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android' && !channelsConfigured) {
    await Promise.all([
      Notifications.setNotificationChannelAsync('work-progress', {
        name: 'Work progress',
        description: 'Progress reminders while a visit timer is running.',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: COLORS.primary,
      }),
      Notifications.setNotificationChannelAsync('work-warning', {
        name: 'Work time warnings',
        description: 'Time-sensitive reminders near the planned end of a visit.',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 180, 120, 180],
        lightColor: COLORS.warning,
      }),
      Notifications.setNotificationChannelAsync('visit-reminders', {
        name: 'Visit reminders',
        description: 'Upcoming confirmed visit reminders.',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: COLORS.ink,
      }),
      Notifications.setNotificationChannelAsync('schedule-confirmation', {
        name: 'Schedule confirmations',
        description: 'Reminders when tomorrow\'s work still needs a response.',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: COLORS.accent,
      }),
    ]);
    channelsConfigured = true;
  }
  return Notifications;
}

function ownAssignment(visit: Visit, email: string) {
  const normalized = email.toLowerCase();
  return visit.assignments?.find((assignment) => assignment.user.email.toLowerCase() === normalized) ?? null;
}

function ownEntries(visit: Visit, email: string) {
  const normalized = email.toLowerCase();
  return (visit.timeEntries ?? []).filter((entry) => entry.user?.email.toLowerCase() === normalized);
}

function recordedSeconds(entry: TimeEntry) {
  if (entry.durationSeconds != null) return Math.max(0, entry.durationSeconds);
  if (!entry.endedAt) return 0;
  return Math.max(0, Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000));
}

function workReminders(visit: Visit, email: string, now: Date): PlannedReminder[] {
  const entries = ownEntries(visit, email);
  const running = entries.find((entry) => entry.kind === 'visit' && entry.status === 'running' && !entry.endedAt);
  const paused = entries.some((entry) => entry.kind === 'break' && entry.status === 'running' && !entry.endedAt);
  if (!running || paused || visit.status === 'completed') return [];

  const plannedSeconds = Math.max(1, Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 1000));
  const completedSeconds = entries
    .filter((entry) => entry.kind === 'visit' && Boolean(entry.endedAt))
    .reduce((sum, entry) => sum + recordedSeconds(entry), 0);
  const currentSeconds = Math.max(0, Math.floor((now.getTime() - new Date(running.startedAt).getTime()) / 1000));
  const workedSeconds = completedSeconds + currentSeconds;
  const client = visit.site.client.displayName;
  const reminders: PlannedReminder[] = [];
  const targets: Array<{
    target: number;
    milestone: 'half' | '30m' | '5m';
    title: string;
    body: string;
    tone: ReminderTone;
    channelId: PlannedReminder['channelId'];
  }> = [];

  // Halfway and 30 minutes remaining are the same moment for a 60-minute visit.
  // In that case send one stronger 30-minute reminder instead of a duplicate pair.
  const halfRemainingSeconds = plannedSeconds / 2;
  if (Math.abs(halfRemainingSeconds - 30 * 60) > 30) {
    targets.push({
      target: plannedSeconds / 2,
      milestone: 'half',
      title: 'Halfway through',
      body: `${client} · Half of the planned visit is complete.`,
      tone: 'primary',
      channelId: 'work-progress',
    });
  }
  if (plannedSeconds > 30 * 60) {
    targets.push({
      target: plannedSeconds - 30 * 60,
      milestone: '30m',
      title: '30 minutes planned remaining',
      body: `${client} · Start thinking about the final tasks and closeout.`,
      tone: 'warning',
      channelId: 'work-warning',
    });
  }
  if (plannedSeconds > 5 * 60) {
    targets.push({
      target: plannedSeconds - 5 * 60,
      milestone: '5m',
      title: '5 minutes planned remaining',
      body: `${client} · Finish safely, then stop your timer and complete closeout.`,
      tone: 'danger',
      channelId: 'work-warning',
    });
  }

  const seenTargets = new Set<number>();
  for (const item of targets.sort((a, b) => a.target - b.target)) {
    const roundedTarget = Math.round(item.target);
    if (seenTargets.has(roundedTarget)) continue;
    seenTargets.add(roundedTarget);
    const secondsUntil = roundedTarget - workedSeconds;
    if (secondsUntil < 10) continue;
    reminders.push({
      date: new Date(now.getTime() + secondsUntil * 1000),
      title: item.title,
      body: item.body,
      type: 'work_progress',
      visitId: visit.id,
      milestone: item.milestone,
      channelId: item.channelId,
      tone: item.tone,
    });
  }
  return reminders;
}

function plannedScheduleReminders(
  visits: Visit[],
  commitments: WorkCommitment[],
  email: string,
  defaultTimezone: string,
  now: Date,
) {
  const reminders: PlannedReminder[] = [];
  const confirmedByDay = new Map<string, { timezone: string; visits: Visit[] }>();
  const pendingByDay = new Map<string, { timezone: string; commitments: WorkCommitment[] }>();

  for (const visit of visits) {
    if (['completed', 'cancelled', 'missed'].includes(visit.status)) continue;
    const assignment = ownAssignment(visit, email);
    if (!assignment || assignment.status !== 'acknowledged') continue;
    const timezone = visit.timezone ?? visit.site.timezone ?? defaultTimezone;
    const dayKey = operationalDateKey(visit.scheduledStart, timezone);
    const groupKey = `${timezone}|${dayKey}`;
    const current = confirmedByDay.get(groupKey) ?? { timezone, visits: [] };
    current.visits.push(visit);
    confirmedByDay.set(groupKey, current);

    const twoHoursBefore = new Date(new Date(visit.scheduledStart).getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore.getTime() > now.getTime()) {
      reminders.push({
        date: twoHoursBefore,
        title: 'Visit in 2 hours',
        body: `${visit.site.client.displayName} · ${formatOperationalTime(visit.scheduledStart, timezone)} · ${visit.site.name}`,
        type: 'visit_reminder',
        visitId: visit.id,
        channelId: 'visit-reminders',
        tone: 'ink',
      });
    }
  }

  for (const commitment of commitments) {
    const timezone = commitment.timezone || defaultTimezone;
    const dayKey = operationalDateKey(commitment.scheduledStart, timezone);
    const groupKey = `${timezone}|${dayKey}`;
    const current = pendingByDay.get(groupKey) ?? { timezone, commitments: [] };
    current.commitments.push(commitment);
    pendingByDay.set(groupKey, current);
  }

  for (const [groupKey, group] of confirmedByDay) {
    const dayKey = groupKey.split('|').slice(1).join('|');
    const morning = zonedDateTimeToUtc(dayKey, '08:00', group.timezone);
    if (morning.getTime() <= now.getTime()) continue;
    const sorted = [...group.visits].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
    const first = sorted[0];
    const body = sorted.length === 1
      ? `${first.site.client.displayName} at ${formatOperationalTime(first.scheduledStart, group.timezone)}.`
      : `${sorted.length} confirmed visits today · first is ${first.site.client.displayName} at ${formatOperationalTime(first.scheduledStart, group.timezone)}.`;
    reminders.push({
      date: morning,
      title: 'Your Diamond Shine day',
      body,
      type: 'day_summary',
      channelId: 'visit-reminders',
      tone: 'primary',
    });
  }

  // The canonical work-commitments endpoint already collapses an accepted
  // recurring schedule into a single response. Use it here instead of raw
  // per-occurrence assignment statuses so reminder counts match Today/Work.
  for (const [groupKey, group] of pendingByDay) {
    const dayKey = groupKey.split('|').slice(1).join('|');
    const previousDay = addOperationalDays(dayKey, -1);
    const sorted = [...group.commitments].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
    for (const clock of ['09:00', '13:00']) {
      const date = zonedDateTimeToUtc(previousDay, clock, group.timezone);
      if (date.getTime() <= now.getTime()) continue;
      const first = sorted[0];
      const body = sorted.length === 1
        ? `${first.clientName} is waiting for your confirmation for tomorrow.`
        : `${sorted.length} schedule responses for tomorrow still need your confirmation.`;
      reminders.push({
        date,
        title: 'Schedule needs your response',
        body,
        type: 'schedule_confirmation',
        channelId: 'schedule-confirmation',
        tone: 'accent',
      });
    }
  }

  return reminders;
}

function fingerprint(visits: Visit[], commitments: WorkCommitment[], email: string) {
  return JSON.stringify({
    visits: visits.map((visit) => ({
      id: visit.id,
      status: visit.status,
      start: visit.scheduledStart,
      end: visit.scheduledEnd,
      assignment: ownAssignment(visit, email)?.status ?? null,
      time: ownEntries(visit, email).map((entry) => [entry.id, entry.kind, entry.status, entry.startedAt, entry.endedAt, entry.durationSeconds]),
    })),
    commitments: commitments.map((commitment) => [commitment.key, commitment.scheduledStart, commitment.reason, commitment.occurrences]),
  });
}

async function cancelFieldNotifications(Notifications: NotificationsModule, type?: PlannedReminder['type']) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled
    .filter((request) => request.content.data?.source === FIELD_SOURCE && (!type || request.content.data?.type === type))
    .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}

async function scheduleReminder(Notifications: NotificationsModule, reminder: PlannedReminder) {
  if (reminder.date.getTime() <= Date.now() + 5_000) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.body,
      sound: 'default',
      color: COLORS[reminder.tone],
      interruptionLevel: reminder.milestone === '5m' ? 'timeSensitive' : 'active',
      data: {
        source: FIELD_SOURCE,
        type: reminder.type,
        visitId: reminder.visitId,
        milestone: reminder.milestone,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminder.date,
      channelId: reminder.channelId,
    },
  });
}

export async function reconcileWorkProgressNotifications(
  visits: Visit[],
  session: Pick<Session, 'email'>,
) {
  if (workReconcileInFlight) return workReconcileInFlight;
  workReconcileInFlight = (async () => {
    const Notifications = await notifications();
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    const now = new Date();
    const reminders = visits.flatMap((visit) => workReminders(visit, session.email, now));
    // Offline pause/resume/finish must never destroy tomorrow or 2-hour visit
    // reminders. Only replace timer-progress notifications from the local
    // SQLite snapshot, whose synthetic time entries are updated immediately.
    await cancelFieldNotifications(Notifications, 'work_progress');
    await Promise.all(reminders.map((reminder) => scheduleReminder(Notifications, reminder)));
  })().catch(() => undefined).finally(() => {
    workReconcileInFlight = null;
  });
  return workReconcileInFlight;
}

export async function reconcileFieldNotifications(
  visits: Visit[],
  session: Pick<Session, 'email' | 'timezone'>,
  commitments: WorkCommitment[] = [],
) {
  const nextFingerprint = fingerprint(visits, commitments, session.email);
  if (nextFingerprint === lastFingerprint) return;
  if (reconcileInFlight) {
    await reconcileInFlight;
    if (nextFingerprint === lastFingerprint) return;
  }

  reconcileInFlight = (async () => {
    const Notifications = await notifications();
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;

    const now = new Date();
    const reminders = [
      ...plannedScheduleReminders(visits, commitments, session.email, session.timezone, now),
      ...visits.flatMap((visit) => workReminders(visit, session.email, now)),
    ];

    await cancelFieldNotifications(Notifications);
    await Promise.all(reminders.map((reminder) => scheduleReminder(Notifications, reminder)));
    lastFingerprint = nextFingerprint;
  })().catch(() => undefined).finally(() => {
    reconcileInFlight = null;
  });
  await reconcileInFlight;
}

export function resetFieldNotificationFingerprint() {
  lastFingerprint = '';
}
