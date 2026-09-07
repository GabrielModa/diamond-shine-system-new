import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalDate, formatOperationalTime } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Commitment = {
  key: string;
  scope: 'visit' | 'recurring';
  visitId: string;
  jobId: string;
  clientName: string;
  siteName: string;
  jobName: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  recurrence: unknown;
  occurrences: number;
  reason: 'recurring_schedule' | 'visit_change';
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function recurrenceLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Recurring schedule';
  const rule = value as { frequency?: unknown; interval?: unknown; weekdays?: unknown };
  if (rule.frequency === 'daily') {
    const interval = typeof rule.interval === 'number' ? rule.interval : 1;
    return interval === 1 ? 'Every day' : `Every ${interval} days`;
  }
  if (rule.frequency === 'weekly' && Array.isArray(rule.weekdays)) {
    const days = rule.weekdays.filter((day): day is number => typeof day === 'number').map((day) => WEEKDAYS[day]).filter(Boolean);
    const interval = typeof rule.interval === 'number' ? rule.interval : 1;
    return `${interval === 1 ? 'Every week' : `Every ${interval} weeks`} · ${days.join(' & ')}`;
  }
  return 'Recurring schedule';
}

export default function WorkScreen() {
  const { session } = useAuth();
  const { visits, loading, offline, refresh } = useVisits();
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [commitmentLoading, setCommitmentLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const timezone = session?.timezone ?? 'Europe/Dublin';

  const loadCommitments = useCallback(async () => {
    if (!session || offline) return;
    setCommitmentLoading(true);
    try {
      setCommitments(await apiFetch<Commitment[]>(session, '/api/mobile/work-commitments'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load schedule responses.');
    } finally {
      setCommitmentLoading(false);
    }
  }, [offline, session]);

  useFocusEffect(useCallback(() => { void loadCommitments(); }, [loadCommitments]));

  const ownAssignment = useCallback((visit: (typeof visits)[number]) => visit.assignments?.find((assignment) => assignment.user.email.toLowerCase() === session?.email.toLowerCase()), [session?.email]);
  const actionable = useMemo(() => visits.filter((visit) => !['completed', 'cancelled', 'missed'].includes(visit.status)), [visits]);
  const active = useMemo(() => actionable.find((visit) => visit.status === 'in_progress' || visit.timeEntries?.some((entry) => entry.kind === 'visit' && entry.status === 'running' && !entry.endedAt)), [actionable]);
  const confirmed = useMemo(() => actionable.filter((visit) => ownAssignment(visit)?.status === 'acknowledged'), [actionable, ownAssignment]);
  const next = active ?? confirmed[0] ?? actionable[0];
  const upcoming = confirmed.filter((visit) => visit.id !== next?.id).slice(0, 4);
  const issues = actionable.flatMap((visit) => (visit.incidents ?? []).filter((incident) => !['resolved', 'closed'].includes(incident.status)).map((incident) => ({ ...incident, visit })));
  const window = (start: string, end: string, visitTimezone?: string) => `${formatOperationalTime(start, visitTimezone ?? timezone)}–${formatOperationalTime(end, visitTimezone ?? timezone)}`;

  async function accept(commitment: Commitment) {
    if (!session) return;
    if (offline) {
      setError('Reconnect briefly to confirm this schedule. Your saved work remains available offline.');
      return;
    }
    setBusyKey(commitment.key); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ scope: string; affectedVisits: number }>(session, `/api/visits/${commitment.visitId}/acknowledgement`, {
        method: 'POST',
        body: JSON.stringify({ status: 'acknowledged', scope: commitment.scope }),
      });
      setMessage(commitment.scope === 'recurring'
        ? `Recurring schedule accepted. ${result.affectedVisits} upcoming visit${result.affectedVisits === 1 ? '' : 's'} confirmed.`
        : 'Schedule change confirmed.');
      await Promise.all([refresh(), loadCommitments()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm this schedule.');
    } finally {
      setBusyKey(null);
    }
  }

  return <Screen><PageHeader eyebrow={offline ? 'Saved work package' : 'Field control'} title={active ? 'Active work' : 'My work'} subtitle={active ? 'Stay focused on the visit in front of you.' : 'Responses first, then the next confirmed job.'} />
    {message ? <Text style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : <>
      {active ? <Card style={[styles.primary, styles.primaryActive]}>
        <Text style={styles.kicker}>In progress now</Text>
        <Text style={styles.client}>{active.site.client.displayName}</Text>
        <Text style={styles.visit}>{active.job?.name ?? active.site.name}</Text>
        <Text style={styles.meta}>{window(active.scheduledStart, active.scheduledEnd, active.timezone)} · {formatMinutes(minutesBetween(active.scheduledStart, active.scheduledEnd))} planned</Text>
        <Text style={styles.meta}>{active.site.addressLine1}, {active.site.city}</Text>
        <Button title="Continue visit" onPress={() => router.push(`/visit/${active.id}`)} />
      </Card> : null}

      {commitments.length ? <Card style={styles.attention}>
        <View style={styles.attentionHead}>
          <View style={styles.attentionCopyWrap}>
            <Text style={styles.attentionTitle}>{commitments.length} schedule response{commitments.length === 1 ? '' : 's'} needed</Text>
            <Text style={styles.attentionCopy}>Recurring work is accepted once. We only ask again when the schedule itself changes.</Text>
          </View>
          {commitmentLoading ? <ActivityIndicator color={colors.warning} /> : null}
        </View>
        {commitments.map((commitment) => <View key={commitment.key} style={styles.commitment}>
          <View style={styles.commitmentCopy}>
            <Text style={styles.commitmentKind}>{commitment.scope === 'recurring' ? 'Recurring assignment' : 'Schedule changed'}</Text>
            <Text style={styles.commitmentTitle}>{commitment.clientName}</Text>
            <Text style={styles.commitmentMeta}>{commitment.scope === 'recurring' ? recurrenceLabel(commitment.recurrence) : formatOperationalDate(commitment.scheduledStart, commitment.timezone, { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            <Text style={styles.commitmentMeta}>{window(commitment.scheduledStart, commitment.scheduledEnd, commitment.timezone)} · {formatMinutes(minutesBetween(commitment.scheduledStart, commitment.scheduledEnd))} planned</Text>
            {commitment.scope === 'recurring' && commitment.occurrences > 1 ? <Text style={styles.commitmentHint}>{commitment.occurrences} upcoming occurrences covered by this response</Text> : null}
          </View>
          <View style={styles.commitmentActions}>
            <Button title={commitment.scope === 'recurring' ? 'Accept schedule' : 'Confirm change'} compact loading={busyKey === commitment.key} onPress={() => void accept(commitment)} />
            <Button title="Review" variant="secondary" compact onPress={() => router.push(`/visit/${commitment.visitId}`)} />
          </View>
        </View>)}
      </Card> : null}

      {!active && next ? <Card style={styles.primary}>
        <Text style={styles.kicker}>{ownAssignment(next)?.status === 'acknowledged' ? 'Next confirmed visit' : 'Next assigned visit'}</Text>
        <Text style={styles.client}>{next.site.client.displayName}</Text>
        <Text style={styles.visit}>{next.job?.name ?? next.site.name}</Text>
        <Text style={styles.meta}>{formatOperationalDate(next.scheduledStart, next.timezone ?? timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
        <Text style={styles.meta}>{window(next.scheduledStart, next.scheduledEnd, next.timezone)} · {formatMinutes(minutesBetween(next.scheduledStart, next.scheduledEnd))} planned</Text>
        <Button title="Open work package" onPress={() => router.push(`/visit/${next.id}`)} />
      </Card> : !active && !next ? <EmptyState title="No active work" body="Your confirmed visits and schedule responses will stay here, including when you are offline." /> : null}

      {issues.length ? <View style={styles.section}><Text style={styles.sectionTitle}>Open problems</Text>{issues.map(({ id, title, severity, visit }) => <Pressable key={id} onPress={() => router.push(`/visit/${visit.id}`)}><Card style={styles.issue}><View><Text style={styles.issueTitle}>{title}</Text><Text style={styles.issueMeta}>{visit.site.client.displayName} · {visit.site.name}</Text></View><Text style={styles.severity}>{severity}</Text></Card></Pressable>)}</View> : null}

      {upcoming.length ? <View style={styles.section}>
        <View><Text style={styles.sectionTitle}>Up next</Text><Text style={styles.sectionSub}>Confirmed work only</Text></View>
        {upcoming.map((visit) => <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)}><Card style={styles.row}>
          <View style={styles.dateBox}><Text style={styles.dayName}>{formatOperationalDate(visit.scheduledStart, visit.timezone ?? timezone, { weekday: 'short' })}</Text><Text style={styles.dayNumber}>{formatOperationalDate(visit.scheduledStart, visit.timezone ?? timezone, { day: 'numeric' })}</Text></View>
          <View style={styles.rowBody}><Text style={styles.rowTitle}>{visit.site.client.displayName}</Text><Text style={styles.rowMeta}>{window(visit.scheduledStart, visit.scheduledEnd, visit.timezone)} · {formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd))}</Text><Text style={styles.rowMeta}>{visit.site.name} · {visit.site.city}</Text></View>
          <Text style={styles.arrow}>›</Text>
        </Card></Pressable>)}
      </View> : null}
    </>}
  </Screen>;
}

const styles = StyleSheet.create({
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '800', backgroundColor: '#FDECEA' },
  primary: { backgroundColor: colors.ink, borderColor: colors.ink, gap: 7 },
  primaryActive: { backgroundColor: '#123B34' },
  kicker: { color: '#A7E5CE', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  client: { color: '#fff', fontSize: 23, fontWeight: '900' },
  visit: { color: '#D9E5EB', fontSize: 15, fontWeight: '700' },
  meta: { color: '#C8D7DF', fontSize: 12, lineHeight: 18 },
  attention: { backgroundColor: '#FFF8EC', borderColor: '#EBC67A', gap: 14 },
  attentionHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  attentionCopyWrap: { flex: 1 },
  attentionTitle: { color: colors.warning, fontSize: 17, fontWeight: '900' },
  attentionCopy: { color: colors.ink, fontSize: 12, lineHeight: 18, marginTop: 4 },
  commitment: { gap: 10, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#EBDDBE' },
  commitmentCopy: { gap: 3 },
  commitmentKind: { color: colors.warning, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },
  commitmentTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  commitmentMeta: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  commitmentHint: { color: colors.muted, fontSize: 10, marginTop: 2 },
  commitmentActions: { flexDirection: 'row', gap: 8 },
  section: { gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  issue: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderLeftWidth: 4, borderLeftColor: colors.danger },
  issueTitle: { color: colors.ink, fontWeight: '900', fontSize: 15 },
  issueMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  severity: { color: colors.danger, textTransform: 'uppercase', fontSize: 10, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateBox: { width: 48, alignItems: 'center', paddingVertical: 6, borderRadius: 11, backgroundColor: colors.primarySoft },
  dayName: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  dayNumber: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  rowMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  arrow: { color: colors.primary, fontSize: 28 },
});
