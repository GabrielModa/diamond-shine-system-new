import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalTime, operationalDateKey, operationalGreeting } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { useVisits } from '@/lib/use-visits';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const { visits, loading, offline, queued, issues, error, refresh } = useVisits();
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const today = operationalDateKey(new Date(), timezone);
  const todaysVisits = visits.filter((visit) => operationalDateKey(visit.scheduledStart, visit.timezone ?? timezone) === today);
  const completed = todaysVisits.filter((visit) => visit.status === 'completed').length;
  const syncAttention = Boolean(error || issues);
  const firstName = session?.name?.split(' ')[0] ?? 'team';

  return <Screen><PageHeader eyebrow="Field workspace" title={`${operationalGreeting(new Date(), timezone)}, ${firstName}`} subtitle="Everything that needs your attention today." right={<Pressable onPress={() => void signOut()}><Text style={styles.signOut}>Sign out</Text></Pressable>} />
    {offline || queued || syncAttention ? <View style={[styles.syncBanner, syncAttention && styles.syncProblem]}><Text style={[styles.syncTitle, syncAttention && styles.syncProblemTitle]}>{syncAttention ? 'Sync needs attention' : offline ? 'Offline mode' : 'Sync pending'}</Text><Text style={styles.syncText}>{error || (issues ? `${issues} saved change${issues === 1 ? '' : 's'} need review. Successful changes remain saved.` : `${queued} change${queued === 1 ? '' : 's'} waiting safely on this device.`)}</Text><Button title="Sync now" compact variant="secondary" onPress={() => void refresh()} /></View> : null}
    <Card style={styles.summary}><View><Text style={styles.metric}>{todaysVisits.length}</Text><Text style={styles.metricLabel}>Visits today</Text></View><View><Text style={styles.metric}>{completed}</Text><Text style={styles.metricLabel}>Completed</Text></View><View><Text style={styles.metric}>{Math.max(0, todaysVisits.length - completed)}</Text><Text style={styles.metricLabel}>To go</Text></View></Card>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle}>Today&apos;s route</Text><Text style={styles.refresh} onPress={() => void refresh()}>Refresh</Text></View>
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : todaysVisits.length ? todaysVisits.map((visit, index) => <Pressable key={visit.id} onPress={() => router.push(`/visit/${visit.id}`)}><Card style={styles.visit}><View style={styles.routeIndex}><Text style={styles.routeIndexText}>{index + 1}</Text></View><View style={styles.visitBody}><View style={styles.visitTop}><Text style={styles.visitClient}>{visit.site.client.displayName}</Text><Text style={[styles.status, visit.status === 'completed' && styles.statusDone]}>{visit.status.replaceAll('_', ' ')}</Text></View><Text style={styles.visitName}>{visit.job?.name ?? visit.site.name}</Text><Text style={styles.visitMeta}>{formatOperationalTime(visit.scheduledStart, visit.timezone ?? timezone)}–{formatOperationalTime(visit.scheduledEnd, visit.timezone ?? timezone)} · {visit.site.addressLine1}</Text><Text style={styles.open}>Open visit →</Text></View></Card></Pressable>) : <EmptyState title="No visits today" body="Your assigned work will appear here as soon as it is scheduled." />}
  </Screen>;
}

const styles = StyleSheet.create({
  signOut: { color: colors.primary, fontSize: 12, fontWeight: '800', paddingTop: 7 }, syncBanner: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: '#FFF5E8', borderWidth: 1, borderColor: '#F3C98B' }, syncProblem: { backgroundColor: '#FFF2F0', borderColor: '#F2B8B2' }, syncTitle: { color: colors.warning, fontSize: 16, fontWeight: '900' }, syncProblemTitle: { color: colors.danger }, syncText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.ink }, metric: { color: '#fff', fontSize: 25, fontWeight: '900' }, metricLabel: { color: '#C9D6E2', fontSize: 11, fontWeight: '700' }, sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, refresh: { color: colors.primary, fontWeight: '800' },
  visit: { flexDirection: 'row', gap: 12 }, routeIndex: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primarySoft }, routeIndexText: { color: colors.primary, fontWeight: '900' }, visitBody: { flex: 1, gap: 4 }, visitTop: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, visitClient: { flex: 1, color: colors.ink, fontSize: 17, fontWeight: '900' }, status: { color: colors.warning, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, statusDone: { color: colors.success }, visitName: { color: colors.ink, fontWeight: '700' }, visitMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 }, open: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: 4 },
});
