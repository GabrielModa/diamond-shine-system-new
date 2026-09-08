import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { entrySeconds, fieldVisitState, formatMinutes, minutesBetween, ownVisitEntries } from '@/lib/field-presentation';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalTime, operationalDateKey, operationalGreeting } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const { session } = useAuth();
  const { visits, loading, offline, queued, issues, error, refresh } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const today = operationalDateKey(new Date(), timezone);
  const todaysVisits = visits
    .filter((visit) => operationalDateKey(visit.scheduledStart, visit.timezone ?? timezone) === today)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const operationalVisits = todaysVisits.filter((visit) => !['cancelled', 'missed'].includes(visit.status));
  const plannedMinutes = operationalVisits.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
  const workedSeconds = ownVisitEntries(todaysVisits, session?.email).reduce((sum, entry) => sum + entrySeconds(entry), 0);
  const workedMinutes = Math.round(workedSeconds / 60);
  const leftMinutes = Math.max(0, plannedMinutes - workedMinutes);
  const completed = todaysVisits.filter((visit) => visit.status === 'completed').length;
  const syncAttention = Boolean(error || issues);
  const firstName = session?.name?.split(' ')[0] ?? 'team';

  return <Screen>
    <PageHeader
      eyebrow="Today"
      title={`${operationalGreeting(new Date(), timezone)}, ${firstName}`}
      subtitle={`${formatMinutes(plannedMinutes)} planned · ${todaysVisits.length} visit${todaysVisits.length === 1 ? '' : 's'} today`}
    />

    {offline || queued || syncAttention ? <View style={[styles.syncBanner, syncAttention && styles.syncProblem]}>
      <View style={styles.bannerHead}><Ionicons name={syncAttention ? 'warning-outline' : offline ? 'cloud-offline-outline' : 'cloud-upload-outline'} size={20} color={syncAttention ? colors.danger : colors.warning} /><Text style={[styles.syncTitle, syncAttention && styles.syncProblemTitle]}>{syncAttention ? 'Sync needs attention' : offline ? 'Offline mode' : 'Sync pending'}</Text></View>
      <Text style={styles.syncText}>{error || (issues ? `${issues} saved change${issues === 1 ? '' : 's'} need review. Successful changes remain saved.` : `${queued} change${queued === 1 ? '' : 's'} waiting safely on this device.`)}</Text>
      <Button title="Sync now" compact variant="secondary" onPress={() => void refresh()} />
    </View> : null}

    <View style={styles.metricsGrid}>
      <Metric icon="calendar-outline" label="Planned" value={formatMinutes(plannedMinutes)} />
      <Metric icon="checkmark-circle-outline" label="Worked" value={formatMinutes(workedMinutes)} />
      <Metric icon="hourglass-outline" label="Left" value={formatMinutes(leftMinutes)} />
      <Metric icon="briefcase-outline" label="Visits" value={`${completed}/${todaysVisits.length}`} hint="done" />
    </View>

    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Today&apos;s route</Text><Text style={styles.sectionSub}>{formatMinutes(plannedMinutes)} expected · {formatMinutes(workedMinutes)} recorded</Text></View><Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}><Ionicons name="refresh" size={18} color={colors.primary} /></Pressable></View>

    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : todaysVisits.length ? todaysVisits.map((visit, index) => {
      const state = fieldVisitState(visit, session?.email);
      const duration = formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd));
      return <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)} style={({ pressed }) => pressed && styles.pressed}>
        <Card style={styles.visit}>
          <View style={styles.routeIndex}><Text style={styles.routeIndexText}>{index + 1}</Text></View>
          <View style={styles.visitBody}>
            <View style={styles.visitTop}><Text style={styles.visitClient}>{visit.site.client.displayName}</Text><View style={[styles.statusChip, state.tone === 'attention' && styles.statusAttention, state.tone === 'confirmed' && styles.statusConfirmed, state.tone === 'live' && styles.statusLive, state.tone === 'done' && styles.statusDone]}><Text style={[styles.statusText, state.tone === 'attention' && styles.statusTextAttention, state.tone === 'confirmed' && styles.statusTextConfirmed, state.tone === 'live' && styles.statusTextLive, state.tone === 'done' && styles.statusTextDone]}>{state.label}</Text></View></View>
            <Text style={styles.visitName}>{visit.job?.name ?? visit.site.name}</Text>
            <View style={styles.metaRow}><Ionicons name="time-outline" size={15} color={colors.primary} /><Text style={styles.visitMeta}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}–{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)} · <Text style={styles.durationStrong}>{duration} planned</Text></Text></View>
            <View style={styles.metaRow}><Ionicons name="location-outline" size={15} color={colors.muted} /><Text style={styles.visitMeta} numberOfLines={2}>{visit.site.name} · {visit.site.addressLine1}</Text></View>
            <View style={styles.openRow}><Text style={styles.open}>Open</Text><Ionicons name="arrow-forward" size={16} color={colors.primary} /></View>
          </View>
        </Card>
      </Pressable>;
    }) : <EmptyState title="No visits today" body="Your assigned work will appear here as soon as it is scheduled." />}
  </Screen>;
}

function Metric({ icon, label, value, hint }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; hint?: string }) {
  return <View style={styles.metricCard}><View style={styles.metricIcon}><Ionicons name={icon} size={18} color="#AEE7D1" /></View><Text style={styles.metric}>{value}</Text><Text style={styles.metricLabel}>{label}{hint ? ` · ${hint}` : ''}</Text></View>;
}

const styles = StyleSheet.create({
  syncBanner: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: '#FFF5E8', borderWidth: 1, borderColor: '#F3C98B' },
  syncProblem: { backgroundColor: '#FFF2F0', borderColor: '#F2B8B2' },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  syncTitle: { color: colors.warning, fontSize: 16, fontWeight: '900' },
  syncProblemTitle: { color: colors.danger },
  syncText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '48%', minHeight: 104, padding: 14, borderRadius: 18, backgroundColor: colors.ink, justifyContent: 'center' },
  metricIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#184358', marginBottom: 8 },
  metric: { color: '#fff', fontSize: 24, fontWeight: '900' },
  metricLabel: { color: '#C9D6E2', fontSize: 11, fontWeight: '700', marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  refreshButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  visit: { flexDirection: 'row', gap: 12 },
  routeIndex: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft },
  routeIndexText: { color: colors.primary, fontWeight: '900' },
  visitBody: { flex: 1, minWidth: 0, gap: 6 },
  visitTop: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' },
  visitClient: { flex: 1, color: colors.ink, fontSize: 17, lineHeight: 21, fontWeight: '900' },
  visitName: { color: colors.ink, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  visitMeta: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  durationStrong: { color: colors.ink, fontWeight: '800' },
  statusChip: { maxWidth: '48%', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99, backgroundColor: '#EEF2F5' },
  statusText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  statusAttention: { backgroundColor: '#FFF1D6' },
  statusTextAttention: { color: '#B86B00' },
  statusConfirmed: { backgroundColor: '#E8F2FF' },
  statusTextConfirmed: { color: '#315F9B' },
  statusLive: { backgroundColor: colors.primarySoft },
  statusTextLive: { color: colors.success },
  statusDone: { backgroundColor: '#EDF2F5' },
  statusTextDone: { color: '#60717D' },
  openRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  open: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.76 },
});
