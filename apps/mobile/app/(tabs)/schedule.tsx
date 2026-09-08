import { Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { fieldVisitState, formatMinutes, minutesBetween } from '@/lib/field-presentation';
import { useAuth } from '@/lib/auth-context';
import { addOperationalDays, formatOperationalDate, formatOperationalTime, operationalDateKey } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { Visit } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type ScheduleFilter = 'all' | 'confirmed' | 'needs_confirmation';
const PERIODS = [7, 14, 30] as const;

export default function ScheduleScreen() {
  const { session } = useAuth();
  const { visits, loading, offline } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const [periodDays, setPeriodDays] = useState<(typeof PERIODS)[number]>(14);
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const [periodOpen, setPeriodOpen] = useState(false);
  const todayKey = operationalDateKey(new Date(), timezone);
  const endKey = addOperationalDays(todayKey, periodDays);

  const periodVisits = useMemo(() => visits.filter((visit) => {
    const key = operationalDateKey(visit.scheduledStart, visit.timezone ?? timezone);
    return key >= todayKey && key < endKey;
  }).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)), [endKey, timezone, todayKey, visits]);

  const operationalVisits = periodVisits.filter((visit) => !['cancelled', 'missed'].includes(visit.status));
  const totalMinutes = operationalVisits.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
  const confirmed = operationalVisits.filter((visit) => fieldVisitState(visit, session?.email).label === 'Confirmed').length;
  const needsConfirmation = operationalVisits.filter((visit) => fieldVisitState(visit, session?.email).label === 'Needs confirmation').length;
  const filteredVisits = periodVisits.filter((visit) => {
    const label = fieldVisitState(visit, session?.email).label;
    if (filter === 'confirmed') return label === 'Confirmed';
    if (filter === 'needs_confirmation') return label === 'Needs confirmation';
    return true;
  });
  const groups = filteredVisits.reduce<Record<string, Visit[]>>((result, visit) => {
    const key = operationalDateKey(visit.scheduledStart, visit.timezone ?? timezone);
    (result[key] ??= []).push(visit);
    return result;
  }, {});
  const orderedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  const filterLabel = filter === 'confirmed' ? 'Confirmed' : filter === 'needs_confirmation' ? 'Needs confirmation' : 'All visits';

  return <Screen>
    <PageHeader
      eyebrow={offline ? 'Saved schedule' : `${periodDays}-day plan`}
      title="My schedule"
      subtitle={`${formatMinutes(totalMinutes)} scheduled · ${operationalVisits.length} visit${operationalVisits.length === 1 ? '' : 's'} in this planning window.`}
    />

    <View style={styles.summary}>
      <SummaryMetric icon="time-outline" label="Scheduled" value={formatMinutes(totalMinutes)} caption={`${periodDays} days`} selected={periodOpen} onPress={() => setPeriodOpen((value) => !value)} />
      <SummaryMetric icon="checkmark-circle-outline" label="Confirmed" value={`${confirmed}`} selected={filter === 'confirmed'} onPress={() => { setFilter((value) => value === 'confirmed' ? 'all' : 'confirmed'); setPeriodOpen(false); }} />
      <SummaryMetric icon="alert-circle-outline" label="Need confirmation" value={`${needsConfirmation}`} attention={needsConfirmation > 0} selected={filter === 'needs_confirmation'} onPress={() => { setFilter((value) => value === 'needs_confirmation' ? 'all' : 'needs_confirmation'); setPeriodOpen(false); }} />
    </View>

    {periodOpen ? <Card style={styles.periodCard}>
      <View style={styles.periodHead}><View style={styles.periodHeadCopy}><Text style={styles.periodTitle}>Planning window</Text><Text style={styles.periodCopy}>Change how far ahead you want to see.</Text></View><Ionicons name="calendar-outline" size={20} color={colors.primary} /></View>
      <View style={styles.periodOptions}>{PERIODS.map((days) => <Pressable key={days} accessibilityRole="button" accessibilityState={{ selected: periodDays === days }} onPress={() => { setPeriodDays(days); setPeriodOpen(false); }} style={[styles.periodOption, periodDays === days && styles.periodOptionSelected]}><Text style={[styles.periodOptionText, periodDays === days && styles.periodOptionTextSelected]}>{days} days</Text></Pressable>)}</View>
    </Card> : null}

    <View style={styles.resultBar}>
      <View style={styles.resultCopyWrap}><Text style={styles.resultLabel}>{filterLabel}</Text><Text style={styles.resultCopy}>{filteredVisits.length} visit{filteredVisits.length === 1 ? '' : 's'} shown</Text></View>
      {filter !== 'all' ? <Pressable accessibilityRole="button" accessibilityLabel="Clear schedule filter" onPress={() => setFilter('all')} style={styles.clearFilter}><Text style={styles.clearFilterText}>Clear filter</Text><Ionicons name="close" size={14} color={colors.primary} /></Pressable> : null}
    </View>

    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : orderedGroups.length ? orderedGroups.map(([dayKey, dayVisits]) => {
      const sorted = [...dayVisits].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
      const plannedMinutes = sorted
        .filter((visit) => !['cancelled', 'missed'].includes(visit.status))
        .reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
      const isToday = dayKey === todayKey;
      const dayNeedsConfirmation = sorted.filter((visit) => fieldVisitState(visit, session?.email).label === 'Needs confirmation').length;
      return <View key={dayKey} style={styles.group}>
        <View style={styles.dayHead}>
          <View style={styles.dayCopy}>
            <View style={styles.dayTitleRow}><Text style={styles.day}>{formatOperationalDate(sorted[0].scheduledStart, sorted[0].timezone ?? timezone, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>{isToday ? <Text style={styles.todayChip}>Today</Text> : null}</View>
            <Text style={styles.daySub}>{formatMinutes(plannedMinutes)} scheduled · {sorted.length} visit{sorted.length === 1 ? '' : 's'}{dayNeedsConfirmation ? ` · ${dayNeedsConfirmation} to confirm` : ''}</Text>
          </View>
        </View>

        {sorted.map((visit) => <VisitRow key={visit.id} visit={visit} email={session?.email} timezone={timezone} />)}
      </View>;
    }) : <EmptyState title={filter === 'all' ? 'Schedule is clear' : `No ${filterLabel.toLowerCase()} visits`} body={filter === 'all' ? 'Assigned visits will appear here and remain available offline.' : 'Try another filter or change the planning window.'} />}
  </Screen>;
}

function VisitRow({ visit, email, timezone }: { visit: Visit; email?: string | null; timezone: string }) {
  const state = fieldVisitState(visit, email);
  const duration = formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd));
  const label = `${formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}, ${visit.site.client.displayName}, ${visit.job?.name ?? visit.site.name}, ${state.label}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(`/visit/${visit.id}`)} style={({ pressed }) => pressed && styles.pressed}>
    <Card style={styles.visit}>
      <View style={styles.timeBlock}><Text style={styles.timeMain}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}</Text><Text style={styles.timeEnd}>{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)}</Text><View style={styles.durationPill}><Ionicons name="hourglass-outline" size={11} color={colors.primary} /><Text style={styles.duration}>{duration}</Text></View></View>
      <View style={styles.body}>
        <View style={styles.visitHead}><Text style={styles.client}>{visit.site.client.displayName}</Text><StatusChip state={state} /></View>
        <Text style={styles.name}>{visit.job?.name ?? visit.site.name}</Text>
        <View style={styles.addressRow}><Ionicons name="location-outline" size={13} color={colors.muted} /><Text style={styles.address}>{visit.site.name} · {visit.site.addressLine1}, {visit.site.city}</Text></View>
      </View>
      <Ionicons style={styles.chevron} name="chevron-forward" size={21} color={colors.primary} />
    </Card>
  </Pressable>;
}

function SummaryMetric({ icon, label, value, caption, attention, selected, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; caption?: string; attention?: boolean; selected?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.summaryMetric, attention && styles.summaryAttention, selected && styles.summarySelected, pressed && styles.pressed]}>
    <Ionicons name={icon} size={18} color={attention ? colors.warning : '#AEE7D1'} />
    <Text style={styles.summaryValue}>{value}</Text>
    <Text style={styles.summaryLabel}>{label}</Text>
    {caption ? <Text style={styles.summaryCaption}>{caption} · tap to change</Text> : null}
  </Pressable>;
}

function StatusChip({ state }: { state: ReturnType<typeof fieldVisitState> }) {
  return <View style={[styles.statusChip, state.tone === 'attention' && styles.statusAttention, state.tone === 'confirmed' && styles.statusConfirmed, state.tone === 'live' && styles.statusLive, state.tone === 'done' && styles.statusDone]}>
    <Text style={[styles.statusText, state.tone === 'attention' && styles.statusTextAttention, state.tone === 'confirmed' && styles.statusTextConfirmed, state.tone === 'live' && styles.statusTextLive, state.tone === 'done' && styles.statusTextDone]}>{state.label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summaryMetric: { flexGrow: 1, flexBasis: 110, minWidth: 105, minHeight: 100, padding: 12, borderRadius: 18, justifyContent: 'center', backgroundColor: colors.ink, borderWidth: 2, borderColor: 'transparent' },
  summaryAttention: { borderColor: '#C58A2A' },
  summarySelected: { borderColor: '#62D3A2', backgroundColor: '#12394D' },
  summaryValue: { color: '#fff', fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 6 },
  summaryLabel: { color: '#D4E0E8', fontSize: 10, lineHeight: 14, fontWeight: '800', marginTop: 2 },
  summaryCaption: { color: '#8FA8B7', fontSize: 9, lineHeight: 13, marginTop: 3 },
  periodCard: { gap: 13, backgroundColor: '#F8FBFA', borderColor: '#BFDCCF' },
  periodHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  periodHeadCopy: { flex: 1, minWidth: 0 },
  periodTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  periodCopy: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  periodOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodOption: { flexGrow: 1, flexBasis: 80, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  periodOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  periodOptionText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  periodOptionTextSelected: { color: colors.primaryDark },
  resultBar: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  resultCopyWrap: { flexGrow: 1, minWidth: 150 },
  resultLabel: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  resultCopy: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  clearFilter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: colors.primarySoft },
  clearFilterText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  group: { gap: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 2 },
  dayCopy: { flex: 1 },
  dayTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  day: { color: colors.ink, fontSize: 18, lineHeight: 24, fontWeight: '900', textTransform: 'capitalize' },
  todayChip: { color: colors.primaryDark, backgroundColor: colors.primarySoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99, fontSize: 9, lineHeight: 12, fontWeight: '900' },
  daySub: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  visit: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  timeBlock: { width: 70, flexShrink: 0, gap: 2 },
  timeMain: { color: colors.primary, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  timeEnd: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  durationPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 99, backgroundColor: colors.primarySoft },
  duration: { color: colors.primaryDark, fontSize: 9, lineHeight: 12, fontWeight: '900' },
  body: { flex: 1, minWidth: 0, gap: 4 },
  visitHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'flex-start' },
  client: { flexGrow: 1, flexShrink: 1, minWidth: 120, color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  address: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 15 },
  chevron: { alignSelf: 'center', flexShrink: 0 },
  statusChip: { alignSelf: 'flex-start', flexShrink: 1, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 99, backgroundColor: '#EEF2F5' },
  statusText: { color: colors.muted, fontSize: 8, lineHeight: 11, fontWeight: '900' },
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