import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatOperationalDate, formatOperationalTime, operationalDayRange } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type State = 'covered' | 'needs_staff' | 'unassigned' | 'expected_not_scheduled' | 'unscheduled_service' | 'service_paused' | 'cleaner_overlap' | 'acknowledgement_pending';
type Item = { id: string; state: State; scheduledStart?: string | null; clientName: string; siteName?: string | null; jobName?: string | null; detail: string; requiredWorkers?: number | null; activeWorkers?: number | null; visitId?: string | null };
type Health = { summary: { visits: number; covered: number; needsStaff: number; unassigned: number; missingSchedule: number; unscheduledServices: number; paused: number; conflicts: number; unacknowledged: number; attention: number }; items: Item[] };
const problemStates = new Set<State>(['needs_staff', 'unassigned', 'expected_not_scheduled', 'unscheduled_service', 'cleaner_overlap', 'acknowledgement_pending']);
const labels: Record<State, string> = { covered: 'Covered', needs_staff: 'Needs staff', unassigned: 'Unassigned', expected_not_scheduled: 'Expected · not scheduled', unscheduled_service: 'Unscheduled service', service_paused: 'Service paused', cleaner_overlap: 'Cleaner overlap', acknowledgement_pending: 'Acknowledgement pending' };

export default function OperationsTodayScreen() {
  const { session } = useAuth();
  const [data, setData] = useState<Health | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const role = session?.membershipRole;
  const allowed = role === 'organization_admin' || role === 'field_supervisor' || role === 'scheduler';
  const timezone = session?.timezone ?? 'Europe/Dublin';
  const refresh = useCallback(async () => {
    if (!session || !allowed) return;
    const range = operationalDayRange(new Date(), timezone); setLoading(true); setError('');
    try { setData(await apiFetch<Health>(session, `/api/schedule-health?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load operations health.'); }
    finally { setLoading(false); }
  }, [allowed, session, timezone]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const problems = useMemo(() => (data?.items ?? []).filter((item) => problemStates.has(item.state)), [data?.items]);
  if (!allowed) return <Screen><PageHeader eyebrow="Operations" title="Management view" subtitle="This workspace is available to scheduling and field-management roles." /><Button title="Back" variant="secondary" onPress={() => router.back()} /></Screen>;
  return <Screen><PageHeader eyebrow="Shared schedule intelligence" title="Operations today" subtitle="The same service-continuity truth used by desktop Schedule." />
    {loading ? <ActivityIndicator color={colors.primary} size="large" /> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {data ? <View style={styles.metrics}><Metric value={data.summary.visits} label="visits" /><Metric value={data.summary.covered} label="covered" /><Metric value={data.summary.needsStaff + data.summary.unassigned} label="need staff" /><Metric value={data.summary.missingSchedule + data.summary.unscheduledServices} label="missing" /></View> : null}
    <View style={styles.heading}><Text style={styles.headingTitle}>Needs attention</Text><Text style={styles.headingCopy}>{data?.summary.attention ? `${data.summary.attention} schedule-health issue${data.summary.attention === 1 ? '' : 's'}` : 'No scheduling issues today'}</Text></View>
    {!loading && !problems.length ? <EmptyState title="Schedule is healthy" body="Coverage, recurrence and acknowledgement checks have no active exceptions for today." /> : problems.map((item) => <Pressable key={item.id} accessibilityRole={item.visitId ? 'button' : undefined} onPress={() => item.visitId ? router.push(`/visit/${item.visitId}`) : undefined}><Card style={styles.card}><View style={styles.row}><Text style={styles.state}>{labels[item.state]}</Text>{item.scheduledStart ? <Text style={styles.time}>{formatOperationalTime(item.scheduledStart, timezone)}</Text> : null}</View><Text style={styles.title}>{item.clientName}{item.siteName ? ` · ${item.siteName}` : ''}</Text><Text style={styles.job}>{item.jobName ?? 'Service plan'}</Text><Text style={styles.detail}>{item.detail}</Text>{item.scheduledStart ? <Text style={styles.date}>{formatOperationalDate(item.scheduledStart, timezone, { weekday: 'short', day: 'numeric', month: 'short' })}</Text> : null}</Card></Pressable>)}
    <Button title="Refresh health" variant="secondary" onPress={() => void refresh()} />
  </Screen>;
}
function Metric({ value, label }: { value: number; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
const styles = StyleSheet.create({ error: { padding: 12, borderRadius: 12, backgroundColor: '#FDECEA', color: colors.danger, fontWeight: '800' }, metrics: { flexDirection: 'row', gap: 7 }, metric: { flex: 1, minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, padding: 10 }, metricValue: { color: colors.ink, fontSize: 20, fontWeight: '900' }, metricLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' }, heading: { gap: 2 }, headingTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, headingCopy: { color: colors.muted, fontSize: 12 }, card: { gap: 4 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, state: { color: colors.warning, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, time: { color: colors.ink, fontSize: 13, fontWeight: '900' }, title: { color: colors.ink, fontSize: 16, fontWeight: '900' }, job: { color: colors.primary, fontSize: 12, fontWeight: '800' }, detail: { color: colors.muted, fontSize: 12, lineHeight: 18 }, date: { color: colors.muted, fontSize: 10, marginTop: 3 } });
