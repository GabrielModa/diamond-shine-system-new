import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { fieldVisitState, formatMinutes, minutesBetween } from '@/lib/field-presentation';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalDate, formatOperationalTime, operationalDateKey } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export default function ScheduleScreen() {
  const { session } = useAuth();
  const { visits, loading, offline } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const groups = visits.reduce<Record<string, typeof visits>>((result, visit) => {
    const visitZone = visit.timezone ?? timezone;
    const key = operationalDateKey(visit.scheduledStart, visitZone);
    (result[key] ??= []).push(visit);
    return result;
  }, {});
  const orderedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  const operationalVisits = visits.filter((visit) => !['cancelled', 'missed'].includes(visit.status));
  const totalMinutes = operationalVisits.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
  const confirmed = operationalVisits.filter((visit) => fieldVisitState(visit, session?.email).label === 'Confirmed').length;
  const needsConfirmation = operationalVisits.filter((visit) => fieldVisitState(visit, session?.email).label === 'Needs confirmation').length;

  return <Screen>
    <PageHeader eyebrow={offline ? 'Saved schedule' : 'Next 14 days'} title="My schedule" subtitle="Your week at a glance — hours, visits and what still needs your response." />

    <View style={styles.summary}>
      <SummaryMetric icon="time-outline" label="Planned" value={formatMinutes(totalMinutes)} />
      <SummaryMetric icon="checkmark-circle-outline" label="Confirmed" value={`${confirmed}`} />
      <SummaryMetric icon="alert-circle-outline" label="Needs action" value={`${needsConfirmation}`} attention={needsConfirmation > 0} />
    </View>

    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : orderedGroups.length ? orderedGroups.map(([dayKey, dayVisits]) => {
      const sorted = [...dayVisits].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
      const plannedMinutes = sorted
        .filter((visit) => !['cancelled', 'missed'].includes(visit.status))
        .reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
      const isToday = dayKey === operationalDateKey(new Date(), timezone);
      return <View key={dayKey} style={styles.group}>
        <View style={styles.dayHead}>
          <View style={styles.dayCopy}><View style={styles.dayTitleRow}><Text style={styles.day}>{formatOperationalDate(sorted[0].scheduledStart, sorted[0].timezone ?? timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>{isToday ? <Text style={styles.todayChip}>Today</Text> : null}</View><Text style={styles.daySub}>{formatMinutes(plannedMinutes)} planned · {sorted.length} visit{sorted.length === 1 ? '' : 's'}</Text></View>
        </View>

        {sorted.map((visit) => {
          const state = fieldVisitState(visit, session?.email);
          const duration = formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd));
          return <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)} style={({ pressed }) => pressed && styles.pressed}>
            <Card style={styles.visit}>
              <View style={styles.timeBlock}><Text style={styles.timeMain}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}</Text><Text style={styles.timeEnd}>{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)}</Text><View style={styles.durationPill}><Ionicons name="hourglass-outline" size={11} color={colors.primary} /><Text style={styles.duration}>{duration}</Text></View></View>
              <View style={styles.body}>
                <View style={styles.visitHead}><Text style={styles.client}>{visit.site.client.displayName}</Text><View style={[styles.statusChip, state.tone === 'attention' && styles.statusAttention, state.tone === 'confirmed' && styles.statusConfirmed, state.tone === 'live' && styles.statusLive, state.tone === 'done' && styles.statusDone]}><Text style={[styles.statusText, state.tone === 'attention' && styles.statusTextAttention, state.tone === 'confirmed' && styles.statusTextConfirmed, state.tone === 'live' && styles.statusTextLive, state.tone === 'done' && styles.statusTextDone]}>{state.label}</Text></View></View>
                <Text style={styles.name}>{visit.job?.name ?? visit.site.name}</Text>
                <View style={styles.addressRow}><Ionicons name="location-outline" size={13} color={colors.muted} /><Text style={styles.address} numberOfLines={2}>{visit.site.name} · {visit.site.addressLine1}, {visit.site.city}</Text></View>
              </View>
              <Ionicons name="chevron-forward" size={21} color={colors.primary} />
            </Card>
          </Pressable>;
        })}
      </View>;
    }) : <EmptyState title="Schedule is clear" body="Assigned visits will be available here and cached for offline use." />}
  </Screen>;
}

function SummaryMetric({ icon, label, value, attention }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; attention?: boolean }) {
  return <View style={[styles.summaryMetric, attention && styles.summaryAttention]}><Ionicons name={icon} size={18} color={attention ? colors.warning : '#AEE7D1'} /><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', gap: 9 },
  summaryMetric: { flex: 1, minWidth: 0, minHeight: 94, padding: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: colors.ink },
  summaryAttention: { borderWidth: 1, borderColor: '#C58A2A' },
  summaryValue: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 6 },
  summaryLabel: { color: '#C9D6E2', fontSize: 10, fontWeight: '700', marginTop: 2 },
  group: { gap: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2 },
  dayCopy: { flex: 1 },
  dayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  day: { color: colors.ink, fontSize: 18, fontWeight: '900', textTransform: 'capitalize' },
  todayChip: { color: colors.primaryDark, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, fontSize: 9, fontWeight: '900' },
  daySub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  timeBlock: { width: 66, gap: 2 },
  timeMain: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  timeEnd: { color: colors.muted, fontSize: 11 },
  durationPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 99, backgroundColor: colors.primarySoft },
  duration: { color: colors.primaryDark, fontSize: 9, fontWeight: '900' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  visitHead: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  client: { flex: 1, color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  address: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 14 },
  statusChip: { maxWidth: '47%', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 99, backgroundColor: '#EEF2F5' },
  statusText: { color: colors.muted, fontSize: 8, fontWeight: '900' },
  statusAttention: { backgroundColor: '#FFF1D6' },
  statusTextAttention: { color: '#B86B00' },
  statusConfirmed: { backgroundColor: '#E8F2FF' },
  statusTextConfirmed: { color: '#315F9B' },
  statusLive: { backgroundColor: colors.primarySoft },
  statusTextLive: { color: colors.success },
  statusDone: { backgroundColor: '#EDF2F5' },
  statusTextDone: { color: '#60717D' },
  pressed: { opacity: 0.76 },
});
