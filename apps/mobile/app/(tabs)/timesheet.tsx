import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { entrySeconds, formatMinutes, ownVisitEntries } from '@/lib/field-presentation';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { clearLocalTimer, enqueue, getAnyLocalTimer, mutationId, setLocalTimer, type LocalTimer } from '@/lib/offline';
import { formatOperationalDate, formatOperationalTime, operationalDateKey } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { TimeEntry } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const categories = [
  { kind: 'driving', label: 'Driving', hint: 'Travel between sites', icon: 'car-outline' },
  { kind: 'office', label: 'Office', hint: 'Admin and planning', icon: 'business-outline' },
  { kind: 'supplies', label: 'Supplies', hint: 'Collection and delivery', icon: 'cube-outline' },
  { kind: 'break', label: 'Break', hint: 'Unpaid rest period', icon: 'cafe-outline' },
  { kind: 'general', label: 'General', hint: 'Other approved work', icon: 'timer-outline' },
] as const;
type GenericKind = typeof categories[number]['kind'];

export default function TimesheetScreen() {
  const { session } = useAuth();
  const { visits } = useVisits();
  const [generalEntries, setGeneralEntries] = useState<TimeEntry[]>([]);
  const [localTimer, setLocalTimerState] = useState<LocalTimer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const timezone = session?.timezone ?? 'Europe/Dublin';

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    try {
      setGeneralEntries((await apiFetch<TimeEntry[]>(session, `/api/time-entries?mine=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).filter((entry) => entry.kind !== 'visit'));
      setMessage('');
    } catch {
      setMessage('Showing downloaded visit time. Other work will refresh when connected.');
    } finally {
      setLocalTimerState(await getAnyLocalTimer());
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visitEntries = useMemo(() => ownVisitEntries(visits, session?.email), [session?.email, visits]);
  const activeGeneric = generalEntries.find((entry) => entry.status === 'running' && !entry.endedAt);
  const activeVisit = visitEntries.find((entry) => entry.status === 'running' && !entry.endedAt);
  const localGeneric = localTimer?.visitId.startsWith('general:') ? localTimer : null;
  const localVisit = localTimer && !localGeneric ? visits.find((visit) => visit.id === localTimer.visitId) : null;
  const runningKind = (activeGeneric?.kind as GenericKind | undefined) ?? (localGeneric?.visitId.split(':')[1] as GenericKind | undefined);
  const runningSince = activeGeneric?.startedAt ?? localGeneric?.startedAt ?? activeVisit?.startedAt ?? localVisit?.timeEntries?.find((entry) => !entry.endedAt)?.startedAt ?? null;

  useEffect(() => {
    if (!runningSince) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);

  const syntheticLocalGeneric: TimeEntry | null = localGeneric && !activeGeneric
    ? { id: `local:${localGeneric.startMutationId}`, kind: runningKind ?? 'general', status: 'running', startedAt: localGeneric.startedAt }
    : null;
  const allEntries = useMemo(() => {
    const values = [...generalEntries, ...visitEntries, ...(syntheticLocalGeneric ? [syntheticLocalGeneric] : [])];
    const seen = new Set<string>();
    return values.filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
  }, [generalEntries, syntheticLocalGeneric, visitEntries]);
  const todayKey = operationalDateKey(new Date(), timezone);
  const sevenDaysAgo = Date.now() - 6 * 86_400_000;
  const todaySeconds = allEntries.filter((entry) => operationalDateKey(entry.startedAt, timezone) === todayKey).reduce((sum, entry) => sum + entrySeconds(entry, clockNow), 0);
  const weekSeconds = allEntries.filter((entry) => new Date(entry.startedAt).getTime() >= sevenDaysAgo).reduce((sum, entry) => sum + entrySeconds(entry, clockNow), 0);
  const visitSeconds = visitEntries.reduce((sum, entry) => sum + entrySeconds(entry, clockNow), 0);
  const runningElapsed = runningSince ? Math.max(0, Math.floor((clockNow - new Date(runningSince).getTime()) / 1000)) : 0;

  async function coordinates() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { latitude: current.coords.latitude, longitude: current.coords.longitude, accuracyM: current.coords.accuracy };
    } catch { return null; }
  }

  async function connected() { return Boolean((await NetInfo.fetch()).isConnected); }
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the timer.'); } finally { setBusy(false); } }

  async function start(kind: GenericKind) {
    if (!session || activeVisit || activeGeneric || localTimer) return;
    await act(async () => {
      const location = await coordinates();
      const clientMutationId = mutationId('time-start');
      const startedAt = new Date().toISOString();
      const payload = { ...location, startedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'time.start', entityId: kind, clientCreatedAt: startedAt, payload: { ...location, startedAt } });
        const timer = { visitId: `general:${kind}`, startMutationId: clientMutationId, startedAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);
        setMessage(`${label(kind)} saved offline and queued.`);
      };
      if (!(await connected())) return saveOffline();
      try {
        await apiFetch(session, '/api/time-entries', { method: 'POST', body: JSON.stringify({ ...payload, kind }) });
        setMessage(`${label(kind)} timer started.`);
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function stop() {
    if (!session || (!activeGeneric && !localGeneric)) return;
    await act(async () => {
      const location = await coordinates();
      const clientMutationId = mutationId('time-stop');
      const endedAt = new Date().toISOString();
      const payload = { ...location, endedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'time.stop', entityId: activeGeneric?.id ?? localGeneric!.startMutationId, clientCreatedAt: endedAt, payload: { ...payload, startMutationId: localGeneric?.startMutationId } });
        if (localGeneric) await clearLocalTimer(localGeneric.visitId);
        setLocalTimerState(null);
        setMessage('Timer stop saved offline and queued.');
      };
      if (!(await connected())) return saveOffline();
      try {
        if (!activeGeneric) return saveOffline();
        await apiFetch(session, `/api/time-entries/${activeGeneric.id}/stop`, { method: 'POST', body: JSON.stringify(payload) });
        if (localGeneric) await clearLocalTimer(localGeneric.visitId);
        setLocalTimerState(null);
        setMessage('Timer stopped and added to your time log.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  if (loading) return <Screen><ActivityIndicator size="large" color={colors.primary} /></Screen>;

  return <Screen>
    <PageHeader eyebrow="My time" title="Time" subtitle="Your own tracked hours only — visits and approved non-visit work." />
    {message ? <Text style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    <View style={styles.metrics}>
      <TimeMetric label="Today" value={formatMinutes(Math.round(todaySeconds / 60))} icon="today-outline" />
      <TimeMetric label="Last 7 days" value={formatMinutes(Math.round(weekSeconds / 60))} icon="calendar-outline" />
      <TimeMetric label="Visit work" value={formatMinutes(Math.round(visitSeconds / 60))} icon="briefcase-outline" />
    </View>

    {localVisit || activeVisit ? <Card style={styles.running}>
      <View style={styles.runningHead}><View style={styles.liveDot} /><Text style={styles.runningEyebrow}>Visit timer running{localTimer ? ' · offline' : ''}</Text></View>
      <Text style={styles.runningClock}>{formatElapsed(runningElapsed)}</Text>
      <Text style={styles.runningTitle}>{(localVisit ?? activeVisit?.visit)?.site.client.displayName ?? 'Active visit'}</Text>
      <Text style={styles.runningMeta}>{(localVisit ?? activeVisit?.visit)?.site.name ?? 'Open the visit to manage this timer.'}</Text>
      {(localVisit ?? activeVisit?.visit) ? <Button title="Open active visit" onPress={() => router.push(`/visit/${(localVisit ?? activeVisit!.visit).id}`)} /> : null}
    </Card> : runningKind ? <Card style={styles.running}>
      <View style={styles.runningHead}><View style={styles.liveDot} /><Text style={styles.runningEyebrow}>Timer running{localGeneric ? ' · offline' : ''}</Text></View>
      <Text style={styles.runningClock}>{formatElapsed(runningElapsed)}</Text>
      <Text style={styles.runningTitle}>{label(runningKind)}</Text>
      <Text style={styles.runningMeta}>Started {formatOperationalTime(activeGeneric?.startedAt ?? localGeneric!.startedAt, timezone)}</Text>
      <Button title="Stop timer" variant="danger" loading={busy} onPress={() => void stop()} />
    </Card> : <>
      <View><Text style={styles.section}>Track other work</Text><Text style={styles.sectionSub}>Only use these when you are not working inside a scheduled visit.</Text></View>
      <View style={styles.categories}>{categories.map((category) => <Pressable accessibilityRole="button" key={category.kind} disabled={busy} onPress={() => void start(category.kind)} style={({ pressed }) => [styles.category, pressed && styles.pressed]}><View style={styles.categoryIcon}><Ionicons name={category.icon} size={20} color={colors.primary} /></View><Text style={styles.categoryTitle}>{category.label}</Text><Text style={styles.categoryHint}>{category.hint}</Text></Pressable>)}</View>
    </>}

    <View><Text style={styles.section}>Time log</Text><Text style={styles.sectionSub}>Newest first. Visit entries are filtered to your account.</Text></View>
    {allEntries.length ? [...allEntries].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => {
      const visitEntry = 'visit' in entry ? entry as typeof visitEntries[number] : null;
      const title = visitEntry ? visitEntry.visit.site.client.displayName : label(entry.kind as GenericKind);
      const running = !entry.endedAt;
      return <Card key={entry.id} style={styles.entry}><View style={[styles.dot, running && styles.dotLive]} /><View style={styles.body}><Text style={styles.site}>{title}</Text><Text style={styles.meta}>{formatOperationalDate(entry.startedAt, timezone, { weekday: 'short', day: 'numeric', month: 'short' })} · {formatOperationalTime(entry.startedAt, timezone)}{entry.endedAt ? `–${formatOperationalTime(entry.endedAt, timezone)}` : ' · Running'}</Text></View><Text style={[styles.duration, running && styles.durationLive]}>{running ? formatElapsed(entrySeconds(entry, clockNow)) : formatMinutes(Math.round(entrySeconds(entry, clockNow) / 60))}</Text></Card>;
    }) : <EmptyState title="No tracked time yet" body="Start a visit or choose another work category above." />}
  </Screen>;
}

function TimeMetric({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.metric}><Ionicons name={icon} size={17} color="#AEE7D1" /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function label(kind: GenericKind | 'visit') { return kind === 'visit' ? 'Visit' : categories.find((item) => item.kind === kind)?.label ?? 'General'; }
function formatElapsed(seconds: number) { const safe = Math.max(0, Math.floor(seconds)); const h = Math.floor(safe / 3600); const m = Math.floor((safe % 3600) / 60); const s = safe % 60; return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':'); }

const styles = StyleSheet.create({
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' },
  metrics: { flexDirection: 'row', gap: 9 },
  metric: { flex: 1, minWidth: 0, minHeight: 92, justifyContent: 'center', padding: 12, borderRadius: 17, backgroundColor: colors.ink },
  metricValue: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 7 },
  metricLabel: { color: '#C9D6E2', fontSize: 9, fontWeight: '700', marginTop: 2 },
  section: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  category: { width: '48%', minHeight: 112, justifyContent: 'center', padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  categoryIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primarySoft, marginBottom: 8 },
  categoryTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  categoryHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 4 },
  pressed: { opacity: .75, transform: [{ scale: .98 }] },
  running: { gap: 8, borderWidth: 1, borderColor: '#8DCDB5', backgroundColor: '#FBFEFC' },
  runningHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: colors.success },
  runningEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  runningClock: { color: colors.ink, fontSize: 36, lineHeight: 42, fontWeight: '900', fontVariant: ['tabular-nums'] },
  runningTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  runningMeta: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  dot: { width: 11, height: 11, borderRadius: 99, backgroundColor: colors.primary },
  dotLive: { backgroundColor: colors.success },
  body: { flex: 1, minWidth: 0 },
  site: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  duration: { color: colors.primary, fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  durationLive: { color: colors.success },
});
