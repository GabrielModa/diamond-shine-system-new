import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalDate, formatOperationalTime } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { useWorkCommitments, type WorkCommitment } from '@/lib/use-work-commitments';
import { formatPlannedMinutes, visitMinutes } from '@/lib/work-planning';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function recurrenceLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Recurring schedule';
  const rule = value as { frequency?: unknown; interval?: unknown; weekdays?: unknown };
  if (rule.frequency === 'daily') {
    const interval = typeof rule.interval === 'number' ? rule.interval : 1;
    return interval === 1 ? 'Every day' : `Every ${interval} days`;
  }
  if (rule.frequency === 'weekly' && Array.isArray(rule.weekdays)) {
    const days = rule.weekdays
      .filter((day): day is number => typeof day === 'number')
      .map((day) => WEEKDAYS[day])
      .filter(Boolean);
    const interval = typeof rule.interval === 'number' ? rule.interval : 1;
    return `${interval === 1 ? 'Every week' : `Every ${interval} weeks`} · ${days.join(' & ')}`;
  }
  return 'Recurring schedule';
}

export default function WorkScreen() {
  const { session } = useAuth();
  const { offline, refresh } = useVisits();
  const { commitments, loading, error: commitmentError, refresh: refreshCommitments } = useWorkCommitments();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function accept(commitment: WorkCommitment) {
    if (!session) return;
    if (offline) {
      setError('Reconnect briefly to confirm this schedule. Your saved schedule is still available offline.');
      return;
    }
    setBusyKey(commitment.key);
    setError('');
    setMessage('');
    try {
      const result = await apiFetch<{ scope: string; affectedVisits: number }>(session, `/api/visits/${commitment.visitId}/acknowledgement`, {
        method: 'POST',
        body: JSON.stringify({ status: 'acknowledged', scope: commitment.scope }),
      });
      setMessage(commitment.scope === 'recurring'
        ? `Schedule confirmed once. ${result.affectedVisits} upcoming visit${result.affectedVisits === 1 ? '' : 's'} are covered.`
        : 'Schedule change confirmed.');
      await Promise.all([refresh(), refreshCommitments(true)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not confirm this schedule.');
    } finally {
      setBusyKey(null);
    }
  }

  const visibleError = error || commitmentError;
  return <Screen>
    <PageHeader
      eyebrow={offline ? 'Saved responses' : 'Schedule responses'}
      title="Schedule responses"
      subtitle="Confirm recurring work once. We only ask again when the schedule changes."
    />

    {message ? <Text style={styles.success}>{message}</Text> : null}
    {visibleError ? <Text accessibilityRole="alert" style={styles.error}>{visibleError}</Text> : null}
    {offline ? <Card style={styles.offlineCard}>
      <View style={styles.offlineHead}><Ionicons name="cloud-offline-outline" size={20} color={colors.warning} /><Text style={styles.offlineTitle}>Reconnect to respond</Text></View>
      <Text style={styles.offlineCopy}>You can keep using Today, Schedule and Time offline. A schedule confirmation needs a brief connection.</Text>
    </Card> : null}

    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : commitments.length ? <>
      <View style={styles.summaryRow}>
        <View style={styles.summaryIcon}><Ionicons name="checkmark-done-outline" size={20} color={colors.warning} /></View>
        <View style={styles.summaryCopy}><Text style={styles.summaryTitle}>{commitments.length} response{commitments.length === 1 ? '' : 's'} needed</Text><Text style={styles.summarySub}>These are your responses only. Recurring visits are grouped into one confirmation.</Text></View>
      </View>

      {commitments.map((commitment) => <Card key={commitment.key} style={styles.commitment}>
        <View style={styles.commitmentHead}>
          <View style={[styles.kindIcon, commitment.scope === 'recurring' ? styles.kindRecurring : styles.kindChanged]}>
            <Ionicons name={commitment.scope === 'recurring' ? 'repeat-outline' : 'calendar-outline'} size={18} color={commitment.scope === 'recurring' ? colors.primary : colors.warning} />
          </View>
          <View style={styles.commitmentHeadCopy}>
            <Text style={styles.commitmentKind}>{commitment.scope === 'recurring' ? 'RECURRING ASSIGNMENT' : 'SCHEDULE CHANGED'}</Text>
            <Text style={styles.commitmentTitle}>{commitment.clientName}</Text>
            <Text style={styles.commitmentSite}>{commitment.jobName || commitment.siteName}</Text>
          </View>
        </View>

        <View style={styles.details}>
          <View style={styles.detailRow}><Ionicons name="calendar-outline" size={16} color={colors.muted} /><Text style={styles.detailText}>{commitment.scope === 'recurring' ? recurrenceLabel(commitment.recurrence) : formatOperationalDate(commitment.scheduledStart, commitment.timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</Text></View>
          <View style={styles.detailRow}><Ionicons name="time-outline" size={16} color={colors.muted} /><Text style={styles.detailText}>{formatOperationalTime(commitment.scheduledStart, commitment.timezone)}–{formatOperationalTime(commitment.scheduledEnd, commitment.timezone)} · {formatPlannedMinutes(visitMinutes(commitment))}</Text></View>
          <View style={styles.detailRow}><Ionicons name="location-outline" size={16} color={colors.muted} /><Text style={styles.detailText}>{commitment.siteName}</Text></View>
        </View>

        {commitment.scope === 'recurring' ? <View style={styles.coverage}>
          <Ionicons name="shield-checkmark-outline" size={17} color={colors.primary} />
          <Text style={styles.coverageText}>{commitment.occurrences > 1 ? `${commitment.occurrences} upcoming visits are covered by one confirmation.` : 'Future matching visits stay confirmed until the schedule changes.'}</Text>
        </View> : null}

        <View style={styles.actions}>
          <View style={styles.primaryAction}><Button title={commitment.scope === 'recurring' ? 'Confirm schedule' : 'Confirm change'} loading={busyKey === commitment.key} onPress={() => void accept(commitment)} /></View>
          <Pressable accessibilityRole="button" onPress={() => router.push(`/visit/${commitment.visitId}`)} style={({ pressed }) => [styles.reviewAction, pressed && styles.pressed]}><Text style={styles.reviewText}>Review visit</Text><Ionicons name="chevron-forward" size={17} color={colors.primary} /></Pressable>
        </View>
      </Card>)}
    </> : <EmptyState title="You're all set" body="There are no schedule changes waiting for your response." />}

    <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/schedule')} style={({ pressed }) => [styles.backToSchedule, pressed && styles.pressed]}>
      <Ionicons name="calendar-outline" size={18} color={colors.primary} />
      <Text style={styles.backToScheduleText}>Back to Schedule</Text>
    </Pressable>
  </Screen>;
}

const styles = StyleSheet.create({
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '800', backgroundColor: '#FDECEA' },
  offlineCard: { gap: 8, backgroundColor: '#FFF8EC', borderColor: '#EBC67A' },
  offlineHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  offlineTitle: { color: colors.warning, fontSize: 15, fontWeight: '900' },
  offlineCopy: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 2 },
  summaryIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0D3' },
  summaryCopy: { flex: 1 },
  summaryTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  summarySub: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  commitment: { gap: 14 },
  commitmentHead: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  kindIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  kindRecurring: { backgroundColor: colors.primarySoft },
  kindChanged: { backgroundColor: '#FFF0D3' },
  commitmentHeadCopy: { flex: 1, minWidth: 0 },
  commitmentKind: { color: colors.warning, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  commitmentTitle: { color: colors.ink, fontSize: 19, lineHeight: 23, fontWeight: '900', marginTop: 3 },
  commitmentSite: { color: colors.ink, fontSize: 12, fontWeight: '700', marginTop: 3 },
  details: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F7F9FA' },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  detailText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  coverage: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 11, borderRadius: 13, backgroundColor: colors.primarySoft },
  coverageText: { flex: 1, color: colors.primaryDark, fontSize: 11, lineHeight: 16, fontWeight: '700' },
  actions: { gap: 8 },
  primaryAction: { width: '100%' },
  reviewAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 13, backgroundColor: colors.surface },
  reviewText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  backToSchedule: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: colors.primarySoft },
  backToScheduleText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.76 },
});
