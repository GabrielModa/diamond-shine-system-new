import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { clearLocalTimer, enqueue, getGenericLocalTimer, mutationId, setLocalTimer, type LocalTimer } from '@/lib/offline';
import { colors } from '@/lib/theme';
import type { TimeEntry } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const categories = [
  { kind: 'driving', label: 'Driving', hint: 'Travel between sites' },
  { kind: 'office', label: 'Office', hint: 'Admin and planning' },
  { kind: 'supplies', label: 'Supplies', hint: 'Collection and delivery' },
  { kind: 'break', label: 'Break', hint: 'Unpaid rest period' },
  { kind: 'general', label: 'General', hint: 'Other approved work' },
] as const;
type GenericKind = typeof categories[number]['kind'];

export default function TimesheetScreen() {
  const { session } = useAuth(); const { visits } = useVisits();
  const [generalEntries, setGeneralEntries] = useState<TimeEntry[]>([]); const [localTimer, setLocalTimerState] = useState<LocalTimer | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session) return; setLoading(true);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString(); const to = new Date(Date.now() + 86_400_000).toISOString();
    try { setGeneralEntries((await apiFetch<TimeEntry[]>(session, `/api/time-entries?mine=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).filter((entry) => entry.kind !== 'visit')); }
    catch { setMessage('Showing downloaded visit time. Other categories will refresh when connected.'); }
    finally { setLocalTimerState(await getGenericLocalTimer()); setLoading(false); }
  }, [session]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visitEntries = useMemo(() => visits.flatMap((visit) => (visit.timeEntries ?? []).map((entry) => ({ ...entry, visit }))), [visits]);
  const activeGeneric = generalEntries.find((entry) => entry.status === 'running' && !entry.endedAt);
  const activeVisit = visitEntries.find((entry) => entry.status === 'running' && !entry.endedAt);
  const allEntries = [...generalEntries, ...visitEntries];
  const total = allEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? (entry.endedAt ? (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000 : 0)), 0);

  async function coordinates() {
    const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted') return null;
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: current.coords.latitude, longitude: current.coords.longitude, accuracyM: current.coords.accuracy };
  }
  async function online() { return Boolean((await NetInfo.fetch()).isConnected); }
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the timer.'); } finally { setBusy(false); } }

  async function start(kind: GenericKind) { if (!session || activeVisit || activeGeneric || localTimer) return; await act(async () => {
    const location = await coordinates(); const clientMutationId = mutationId('time-start'); const startedAt = new Date().toISOString(); const payload = { ...location, startedAt, clientMutationId, deviceId: await getDeviceId() };
    if (await online()) { await apiFetch(session, '/api/time-entries', { method: 'POST', body: JSON.stringify({ ...payload, kind }) }); setMessage(`${label(kind)} timer started.`); await load(); }
    else { await enqueue({ clientMutationId, type: 'time.start', entityId: kind, clientCreatedAt: startedAt, payload: location ?? {} }); const timer = { visitId: `general:${kind}`, startMutationId: clientMutationId, startedAt }; await setLocalTimer(timer); setLocalTimerState(timer); setMessage(`${label(kind)} saved offline and queued.`); }
  }); }

  async function stop() { if (!session || (!activeGeneric && !localTimer)) return; await act(async () => {
    const location = await coordinates(); const clientMutationId = mutationId('time-stop'); const endedAt = new Date().toISOString(); const payload = { ...location, endedAt, clientMutationId, deviceId: await getDeviceId() };
    if (await online() && activeGeneric) { await apiFetch(session, `/api/time-entries/${activeGeneric.id}/stop`, { method: 'POST', body: JSON.stringify(payload) }); if (localTimer) await clearLocalTimer(localTimer.visitId); setLocalTimerState(null); setMessage('Timer stopped and added to your timesheet.'); await load(); }
    else { await enqueue({ clientMutationId, type: 'time.stop', entityId: activeGeneric?.id ?? localTimer!.startMutationId, clientCreatedAt: endedAt, payload: { ...payload, startMutationId: localTimer?.startMutationId } }); if (localTimer) await clearLocalTimer(localTimer.visitId); setLocalTimerState(null); setMessage('Timer stop saved offline and queued.'); }
  }); }

  if (loading) return <Screen><ActivityIndicator size="large" color={colors.primary} /></Screen>;
  const localKind = localTimer?.visitId.split(':')[1] as GenericKind | undefined; const runningKind = activeGeneric?.kind as GenericKind | undefined ?? localKind;
  return <Screen><PageHeader eyebrow="Verified time" title="Timesheet" subtitle="Visits, travel, supplies, office work and breaks in one auditable timeline." />
    {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Card style={styles.total}><Text style={styles.totalLabel}>Tracked in this schedule window</Text><Text style={styles.totalValue}>{duration(total)}</Text></Card>
    {runningKind ? <Card style={styles.running}><View><Text style={styles.runningEyebrow}>Timer running{localTimer ? ' · offline' : ''}</Text><Text style={styles.runningTitle}>{label(runningKind)}</Text><Text style={styles.runningMeta}>Started {formatTime(activeGeneric?.startedAt ?? localTimer!.startedAt)}</Text></View><Button title="Stop" variant="danger" compact loading={busy} onPress={() => void stop()} /></Card> : <><Text style={styles.section}>Track other work</Text>{activeVisit ? <Card><Text style={styles.site}>A visit timer is running</Text><Text style={styles.meta}>Stop it from the visit before starting another activity.</Text></Card> : <View style={styles.categories}>{categories.map((category) => <Pressable accessibilityRole="button" key={category.kind} disabled={busy} onPress={() => void start(category.kind)} style={({ pressed }) => [styles.category, pressed && styles.pressed]}><Text style={styles.categoryTitle}>{category.label}</Text><Text style={styles.categoryHint}>{category.hint}</Text></Pressable>)}</View>}</>}
    <Text style={styles.section}>Time log</Text>{allEntries.length ? allEntries.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => {
      const visitEntry = 'visit' in entry ? entry as typeof visitEntries[number] : null; const title = visitEntry ? visitEntry.visit.site.client.displayName : label(entry.kind as GenericKind);
      return <Card key={entry.id} style={styles.entry}><View style={styles.dot} /><View style={styles.body}><Text style={styles.site}>{title}</Text><Text style={styles.meta}>{formatDate(entry.startedAt)} · {formatTime(entry.startedAt)}{entry.endedAt ? `–${formatTime(entry.endedAt)}` : ' · Running'}</Text></View><Text style={styles.duration}>{entry.endedAt ? duration(entry.durationSeconds ?? (new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000) : 'Live'}</Text></Card>;
    }) : <EmptyState title="No tracked time yet" body="Start a visit or choose another work category above." />}
  </Screen>;
}
function label(kind: GenericKind | 'visit') { return kind === 'visit' ? 'Visit' : categories.find((item) => item.kind === kind)?.label ?? 'General'; }
function duration(seconds: number) { const minutes = Math.round(seconds / 60); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short' }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
const styles = StyleSheet.create({
  total: { backgroundColor: colors.ink }, totalLabel: { color: '#C9D6E2', fontSize: 12, fontWeight: '700' }, totalValue: { color: '#fff', fontSize: 35, fontWeight: '900' },
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft }, error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' },
  section: { color: colors.ink, fontSize: 20, fontWeight: '900' }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, category: { width: '47.5%', minHeight: 88, justifyContent: 'center', padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface }, categoryTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' }, categoryHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 4 }, pressed: { opacity: .75, transform: [{ scale: .98 }] },
  running: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderLeftWidth: 5, borderLeftColor: colors.accent }, runningEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, runningTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 3 }, runningMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 11 }, dot: { width: 11, height: 11, borderRadius: 99, backgroundColor: colors.primary }, body: { flex: 1 }, site: { color: colors.ink, fontSize: 15, fontWeight: '800' }, meta: { color: colors.muted, fontSize: 11, marginTop: 3 }, duration: { color: colors.primary, fontSize: 14, fontWeight: '900' },
});
