import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { entrySeconds, fieldVisitState, formatMinutes, minutesBetween, ownVisitEntries } from '@/lib/field-presentation';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalTime, operationalDateKey, operationalGreeting } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { Visit } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const ACTIVE_LABELS = new Set(['In progress', 'Paused', 'Finish visit']);

export default function HomeScreen() {
  const { session } = useAuth();
  const { visits, loading, offline, queued, issues, error, refresh } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const email = session?.email;
  const today = operationalDateKey(new Date(), timezone);
  const todaysVisits = visits
    .filter((visit) => operationalDateKey(visit.scheduledStart, visit.timezone ?? timezone) === today)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const operationalVisits = todaysVisits.filter((visit) => !['cancelled', 'missed'].includes(visit.status));
  const plannedMinutes = operationalVisits.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0);
  const recordedVisitMinutes = Math.round(ownVisitEntries(todaysVisits, email).reduce((sum, entry) => sum + entrySeconds(entry), 0) / 60);
  const completed = operationalVisits.filter((visit) => visit.status === 'completed').length;
  const progress = operationalVisits.length ? completed / operationalVisits.length : 0;
  const progressWidth = `${Math.round(progress * 100)}%` as `${number}%`;
  const syncAttention = Boolean(error || issues);
  const firstName = session?.name?.split(' ')[0] ?? 'team';
  const activeVisit = operationalVisits.find((visit) => ACTIVE_LABELS.has(fieldVisitState(visit, email).label));
  const nextVisit = activeVisit ?? operationalVisits.find((visit) => fieldVisitState(visit, email).label !== 'Done');
  const laterVisits = operationalVisits.filter((visit) => visit.id !== nextVisit?.id && fieldVisitState(visit, email).label !== 'Done');
  const scheduleResponses = visits.filter((visit) => fieldVisitState(visit, email).label === 'Needs confirmation').length;

  return <Screen>
    <PageHeader
      eyebrow="Today"
      title={`${operationalGreeting(new Date(), timezone)}, ${firstName}`}
      subtitle={operationalVisits.length ? `${operationalVisits.length} visit${operationalVisits.length === 1 ? '' : 's'} · ${formatMinutes(plannedMinutes)} scheduled` : 'Your workday is clear.'}
    />

    {offline || queued || syncAttention ? <View style={[styles.syncBanner, syncAttention && styles.syncProblem]}>
      <View style={styles.bannerHead}><Ionicons name={syncAttention ? 'warning-outline' : offline ? 'cloud-offline-outline' : 'cloud-upload-outline'} size={20} color={syncAttention ? colors.danger : colors.warning} /><Text style={[styles.syncTitle, syncAttention && styles.syncProblemTitle]}>{syncAttention ? 'Sync needs attention' : offline ? 'Offline mode' : 'Sync pending'}</Text></View>
      <Text style={styles.syncText}>{error || (issues ? `${issues} saved change${issues === 1 ? '' : 's'} need review. Successful changes remain saved.` : `${queued} change${queued === 1 ? '' : 's'} waiting safely on this device.`)}</Text>
      <Button title="Sync now" compact variant="secondary" onPress={() => void refresh()} />
    </View> : null}

    {scheduleResponses ? <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/work')} style={({ pressed }) => [styles.responseCard, pressed && styles.pressed]}>
      <View style={styles.responseIcon}><Ionicons name="checkmark-done-outline" size={20} color={colors.warning} /></View>
      <View style={styles.responseCopy}><Text style={styles.responseTitle}>{scheduleResponses} schedule response{scheduleResponses === 1 ? '' : 's'} needed</Text><Text style={styles.responseSub}>Confirm recurring work once or review a schedule change.</Text></View>
      <Ionicons name="chevron-forward" size={20} color={colors.primary} />
    </Pressable> : null}

    <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/schedule')} style={({ pressed }) => pressed && styles.pressed}>
      <View style={styles.serviceCard}>
        <View style={styles.serviceTop}>
          <View><Text style={styles.serviceEyebrow}>TODAY&apos;S SERVICE</Text><Text style={styles.serviceValue}>{formatMinutes(plannedMinutes)} scheduled</Text></View>
          <View style={styles.donePill}><Ionicons name="checkmark-circle-outline" size={15} color="#AEE7D1" /><Text style={styles.donePillText}>{completed}/{operationalVisits.length} done</Text></View>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: progressWidth }]} /></View>
        <View style={styles.serviceStats}>
          <View style={styles.serviceStat}><Text style={styles.serviceStatValue}>{formatMinutes(recordedVisitMinutes)}</Text><Text style={styles.serviceStatLabel}>Visit work recorded</Text></View>
          <View style={styles.serviceDivider} />
          <View style={styles.serviceStat}><Text style={styles.serviceStatValue}>{operationalVisits.length}</Text><Text style={styles.serviceStatLabel}>Scheduled visits</Text></View>
        </View>
        <View style={styles.scheduleLink}><Text style={styles.scheduleLinkText}>View schedule</Text><Ionicons name="chevron-forward" size={15} color="#AEE7D1" /></View>
      </View>
    </Pressable>

    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : nextVisit ? <>
      <View style={styles.sectionHead}><View><Text style={styles.sectionEyebrow}>{activeVisit ? 'NOW' : 'NEXT UP'}</Text><Text style={styles.sectionTitle}>{activeVisit ? activeHeading(activeVisit, email) : 'Your next visit'}</Text></View><Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}><Ionicons name="refresh" size={18} color={colors.primary} /></Pressable></View>
      <NextVisitCard visit={nextVisit} email={email} timezone={timezone} active={Boolean(activeVisit)} />
      {laterVisits.length ? <View style={styles.laterSection}>
        <View><Text style={styles.sectionEyebrow}>LATER TODAY</Text><Text style={styles.sectionSub}>{laterVisits.length} more visit{laterVisits.length === 1 ? '' : 's'} · {formatMinutes(laterVisits.reduce((sum, visit) => sum + minutesBetween(visit.scheduledStart, visit.scheduledEnd), 0))}</Text></View>
        {laterVisits.map((visit) => <CompactVisitRow key={visit.id} visit={visit} email={email} timezone={timezone} />)}
      </View> : null}
    </> : operationalVisits.length && completed === operationalVisits.length ? <Card style={styles.allDone}>
      <View style={styles.allDoneIcon}><Ionicons name="checkmark" size={24} color="#fff" /></View>
      <Text style={styles.allDoneTitle}>All done for today</Text>
      <Text style={styles.allDoneCopy}>{formatMinutes(recordedVisitMinutes)} of visit work recorded across {completed} completed visit{completed === 1 ? '' : 's'}.</Text>
    </Card> : <EmptyState title="No visits today" body="Your assigned work will appear here as soon as it is scheduled." />}
  </Screen>;
}

function activeHeading(visit: Visit, email?: string | null) {
  const label = fieldVisitState(visit, email).label;
  if (label === 'Paused') return 'Your visit is paused';
  if (label === 'Finish visit') return 'Finish your visit';
  return 'Continue your visit';
}

function NextVisitCard({ visit, email, timezone, active }: { visit: Visit; email?: string | null; timezone: string; active: boolean }) {
  const state = fieldVisitState(visit, email);
  const duration = formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd));
  const action = state.label === 'Needs confirmation'
    ? 'Review & confirm'
    : state.label === 'Finish visit'
      ? 'Finish visit'
      : state.label === 'Paused'
        ? 'Resume visit'
        : active
          ? 'Continue work'
          : 'Open visit';
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/visit/${visit.id}`)} style={({ pressed }) => pressed && styles.pressed}>
    <Card style={[styles.nextCard, active && styles.nextCardActive]}>
      <View style={styles.nextTop}>
        <View style={styles.nextTime}><Text style={styles.nextTimeMain}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}</Text><Text style={styles.nextTimeEnd}>{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)} · {duration}</Text></View>
        <StatusChip state={state} />
      </View>
      <Text style={styles.nextClient}>{visit.site.client.displayName}</Text>
      <Text style={styles.nextSite}>{visit.job?.name ?? visit.site.name}</Text>
      <View style={styles.metaRow}><Ionicons name="location-outline" size={15} color={colors.muted} /><Text style={styles.nextAddress} numberOfLines={2}>{visit.site.name} · {visit.site.addressLine1}</Text></View>
      <View style={styles.nextAction}><Text style={styles.nextActionText}>{action}</Text><Ionicons name="arrow-forward" size={17} color="#fff" /></View>
    </Card>
  </Pressable>;
}

function CompactVisitRow({ visit, email, timezone }: { visit: Visit; email?: string | null; timezone: string }) {
  const state = fieldVisitState(visit, email);
  const duration = formatMinutes(minutesBetween(visit.scheduledStart, visit.scheduledEnd));
  return <Pressable accessibilityRole="button" onPress={() => router.push(`/visit/${visit.id}`)} style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}>
    <View style={styles.compactTime}><Text style={styles.compactTimeMain}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}</Text><Text style={styles.compactDuration}>{duration}</Text></View>
    <View style={styles.compactBody}><Text style={styles.compactClient} numberOfLines={2}>{visit.site.client.displayName}</Text><Text style={styles.compactSite} numberOfLines={1}>{visit.site.name}</Text></View>
    <StatusChip state={state} />
    <Ionicons name="chevron-forward" size={18} color={colors.primary} />
  </Pressable>;
}

function StatusChip({ state }: { state: ReturnType<typeof fieldVisitState> }) {
  return <View style={[styles.statusChip, state.tone === 'attention' && styles.statusAttention, state.tone === 'confirmed' && styles.statusConfirmed, state.tone === 'live' && styles.statusLive, state.tone === 'done' && styles.statusDone]}>
    <Text style={[styles.statusText, state.tone === 'attention' && styles.statusTextAttention, state.tone === 'confirmed' && styles.statusTextConfirmed, state.tone === 'live' && styles.statusTextLive, state.tone === 'done' && styles.statusTextDone]}>{state.label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  syncBanner: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: '#FFF5E8', borderWidth: 1, borderColor: '#F3C98B' },
  syncProblem: { backgroundColor: '#FFF2F0', borderColor: '#F2B8B2' },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  syncTitle: { color: colors.warning, fontSize: 16, fontWeight: '900' },
  syncProblemTitle: { color: colors.danger },
  syncText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  responseCard: { minHeight: 82, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: '#EDCC86', borderRadius: 17, backgroundColor: '#FFF9EE' },
  responseIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0D3' },
  responseCopy: { flex: 1, minWidth: 0 },
  responseTitle: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  responseSub: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  serviceCard: { padding: 18, borderRadius: 22, backgroundColor: colors.ink, gap: 15 },
  serviceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  serviceEyebrow: { color: '#AEE7D1', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  serviceValue: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 4 },
  donePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 99, backgroundColor: '#173E53' },
  donePillText: { color: '#D9E8E1', fontSize: 10, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 99, backgroundColor: '#24495B', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 99, backgroundColor: '#62D3A2' },
  serviceStats: { flexDirection: 'row', alignItems: 'center' },
  serviceStat: { flex: 1 },
  serviceStatValue: { color: '#fff', fontSize: 17, fontWeight: '900' },
  serviceStatLabel: { color: '#AFC0CC', fontSize: 10, fontWeight: '700', marginTop: 2 },
  serviceDivider: { width: 1, height: 28, backgroundColor: '#345566', marginHorizontal: 10 },
  scheduleLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  scheduleLinkText: { color: '#AEE7D1', fontSize: 11, fontWeight: '800' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionEyebrow: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  sectionTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', marginTop: 2 },
  sectionSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  refreshButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  nextCard: { gap: 9, borderLeftWidth: 5, borderLeftColor: colors.primary },
  nextCardActive: { borderLeftColor: colors.success, backgroundColor: '#F6FFFA' },
  nextTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  nextTime: { flex: 1 },
  nextTimeMain: { color: colors.primary, fontSize: 24, fontWeight: '900' },
  nextTimeEnd: { color: colors.muted, fontSize: 12, marginTop: 2 },
  nextClient: { color: colors.ink, fontSize: 21, lineHeight: 25, fontWeight: '900' },
  nextSite: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  nextAddress: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  nextAction: { minHeight: 44, borderRadius: 13, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.primary, marginTop: 3 },
  nextActionText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  laterSection: { gap: 10 },
  compactRow: { minHeight: 78, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 17, backgroundColor: colors.surface },
  compactTime: { width: 66 },
  compactTimeMain: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  compactDuration: { color: colors.muted, fontSize: 10, marginTop: 3 },
  compactBody: { flex: 1, minWidth: 0 },
  compactClient: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: '900' },
  compactSite: { color: colors.muted, fontSize: 11, marginTop: 3 },
  statusChip: { maxWidth: 115, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 99, backgroundColor: '#EEF2F5' },
  statusText: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  statusAttention: { backgroundColor: '#FFF1D6' },
  statusTextAttention: { color: '#B86B00' },
  statusConfirmed: { backgroundColor: '#E8F2FF' },
  statusTextConfirmed: { color: '#315F9B' },
  statusLive: { backgroundColor: colors.primarySoft },
  statusTextLive: { color: colors.success },
  statusDone: { backgroundColor: '#EDF2F5' },
  statusTextDone: { color: '#60717D' },
  allDone: { alignItems: 'center', paddingVertical: 28 },
  allDoneIcon: { width: 48, height: 48, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
  allDoneTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  allDoneCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  pressed: { opacity: 0.76 },
});
