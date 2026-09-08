import { Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';
import { entrySeconds, entrySecondsOnOperationalDay, entrySecondsWithin, formatMinutes, ownVisitEntries } from '@/lib/field-presentation';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { clearLocalTimer, enqueue, getAnyLocalTimer, mutationId, setLocalTimer, type LocalTimer } from '@/lib/offline';
import { addOperationalDays, formatOperationalDate, formatOperationalTime, operationalDateKey, zonedDateTimeToUtc } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { TimeEntry, Visit } from '@/lib/types';
import { useVisits } from '@/lib/use-visits';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const categories = [
  { kind: 'general', label: 'General', hint: 'Clocked-in work between visits', icon: 'timer-outline' },
  { kind: 'driving', label: 'Driving', hint: 'Travel between sites', icon: 'car-outline' },
  { kind: 'office', label: 'Office', hint: 'Admin and planning', icon: 'business-outline' },
  { kind: 'supplies', label: 'Supplies', hint: 'Collection and delivery', icon: 'cube-outline' },
  { kind: 'break', label: 'Break', hint: 'Rest period', icon: 'cafe-outline' },
] as const;
type GenericKind = typeof categories[number]['kind'];
type TimeLogEntry = TimeEntry & { visit?: Visit | null };

export default function TimesheetScreen() {
  const { session } = useAuth();
  const { visits } = useVisits();
  const canTrackOtherTime = session?.membershipRole === 'field_supervisor' || session?.membershipRole === 'organization_admin';
  const [generalEntries, setGeneralEntries] = useState<TimeLogEntry[]>([]);
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
    setMessage('');
    try {
      if (canTrackOtherTime) {
        const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const to = new Date(Date.now() + 86_400_000).toISOString();
        const entries = await apiFetch<TimeLogEntry[]>(session, `/api/time-entries?mine=true&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        setGeneralEntries(entries.filter((entry) => entry.kind !== 'visit'));
      } else {
        // Cleaners work through scheduled Visits. Do not fetch or present the
        // legacy General/Office/Driving/Supplies ledger on their main Time tab.
        setGeneralEntries([]);
      }
    } catch {
      setMessage(canTrackOtherTime ? 'Showing downloaded visit time. Other supervisor time will refresh when connected.' : 'Showing downloaded visit time.');
    } finally {
      setLocalTimerState(await getAnyLocalTimer());
      setLoading(false);
    }
  }, [canTrackOtherTime, session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visitEntries = useMemo(() => ownVisitEntries(visits, session?.email), [session?.email, visits]);
  const activeGeneric = canTrackOtherTime ? generalEntries.find((entry) => entry.status === 'running' && !entry.endedAt) : undefined;
  const activeVisit = visitEntries.find((entry) => entry.status === 'running' && !entry.endedAt);
  const localGeneric = canTrackOtherTime && localTimer?.visitId.startsWith('general:') ? localTimer : null;
  const localVisit = localTimer && !localTimer.visitId.startsWith('general:') ? visits.find((visit) => visit.id === localTimer.visitId) : null;
  const runningKind = canTrackOtherTime ? (activeGeneric?.kind as GenericKind | undefined) ?? (localGeneric?.visitId.split(':')[1] as GenericKind | undefined) : undefined;
  const activeVisitRecord = localVisit ?? activeVisit?.visit ?? null;
  const runningSince = activeGeneric?.startedAt ?? localGeneric?.startedAt ?? activeVisit?.startedAt ?? localVisit?.timeEntries?.find((entry) => entry.kind === 'visit' && entry.status === 'running' && !entry.endedAt)?.startedAt ?? null;

  useEffect(() => {
    if (!runningSince) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);

  const syntheticLocalGeneric: TimeLogEntry | null = canTrackOtherTime && localGeneric && !activeGeneric
    ? { id: `local:${localGeneric.startMutationId}`, kind: runningKind ?? 'general', status: 'running', startedAt: localGeneric.startedAt }
    : null;
  const allEntries = useMemo<TimeLogEntry[]>(() => {
    const values: TimeLogEntry[] = canTrackOtherTime
      ? [...generalEntries, ...visitEntries, ...(syntheticLocalGeneric ? [syntheticLocalGeneric] : [])]
      : [...visitEntries];
    const seen = new Set<string>();
    return values.filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
  }, [canTrackOtherTime, generalEntries, syntheticLocalGeneric, visitEntries]);

  const todayKey = operationalDateKey(new Date(), timezone);
  const weekFrom = zonedDateTimeToUtc(addOperationalDays(todayKey, -6), '00:00', timezone);
  const weekTo = zonedDateTimeToUtc(addOperationalDays(todayKey, 1), '00:00', timezone);
  const todaySeconds = allEntries.reduce((sum, entry) => sum + entrySecondsOnOperationalDay(entry, new Date(), timezone, clockNow), 0);
  const weekSeconds = allEntries.reduce((sum, entry) => sum + entrySecondsWithin(entry, weekFrom, weekTo, clockNow), 0);
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
    if (!session || !canTrackOtherTime) return;
    if (activeVisitRecord && !activeGeneric) {
      setError('A visit is active. Open the visit to pause or finish it before changing time categories.');
      return;
    }
    if (runningKind === kind) return;

    await act(async () => {
      const location = await coordinates();
      const deviceId = await getDeviceId();
      const switchAt = new Date().toISOString();
      const clientMutationId = mutationId('time-start');
      const startPayload = { ...location, startedAt: switchAt, capturedAt: switchAt, clientMutationId, deviceId };

      const saveOffline = async () => {
        if (activeGeneric || localGeneric) {
          const stopMutationId = mutationId('time-switch-stop');
          await enqueue({
            clientMutationId: stopMutationId,
            type: 'time.stop',
            entityId: activeGeneric?.id ?? localGeneric!.startMutationId,
            clientCreatedAt: switchAt,
            payload: { ...location, endedAt: switchAt, capturedAt: switchAt, startMutationId: localGeneric?.startMutationId },
          });
          if (localGeneric) await clearLocalTimer(localGeneric.visitId);
        }
        await enqueue({ clientMutationId, type: 'time.start', entityId: kind, clientCreatedAt: switchAt, payload: { ...location, startedAt: switchAt, capturedAt: switchAt } });
        const timer = { visitId: `general:${kind}`, startMutationId: clientMutationId, startedAt: switchAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);
        setMessage(`${activityLabel(kind)} saved offline and queued.`);
      };

      if (!(await connected()) || localGeneric) return saveOffline();
      try {
        if (activeGeneric) {
          await apiFetch(session, `/api/time-entries/${activeGeneric.id}/stop`, {
            method: 'POST',
            body: JSON.stringify({ ...location, endedAt: switchAt, capturedAt: switchAt, clientMutationId: mutationId('time-switch-stop'), deviceId }),
          });
        }
        await apiFetch(session, '/api/time-entries', { method: 'POST', body: JSON.stringify({ ...startPayload, kind }) });
        setMessage(activeGeneric ? `Switched to ${activityLabel(kind)}.` : kind === 'general' ? 'Clocked in.' : `${activityLabel(kind)} timer started.`);
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function stop() {
    if (!session || !canTrackOtherTime || (!activeGeneric && !localGeneric)) return;
    await act(async () => {
      const location = await coordinates();
      const clientMutationId = mutationId('time-stop');
      const endedAt = new Date().toISOString();
      const payload = { ...location, endedAt, capturedAt: endedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'time.stop', entityId: activeGeneric?.id ?? localGeneric!.startMutationId, clientCreatedAt: endedAt, payload: { ...payload, startMutationId: localGeneric?.startMutationId } });
        if (localGeneric) await clearLocalTimer(localGeneric.visitId);
        setLocalTimerState(null);
        setMessage('Clock-out saved offline and queued.');
      };
      if (!(await connected()) || !activeGeneric) return saveOffline();
      try {
        await apiFetch(session, `/api/time-entries/${activeGeneric.id}/stop`, { method: 'POST', body: JSON.stringify(payload) });
        if (localGeneric) await clearLocalTimer(localGeneric.visitId);
        setLocalTimerState(null);
        setMessage('Clocked out.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  if (loading) return <Screen><ActivityIndicator size="large" color={colors.primary} /></Screen>;

  return <Screen>
    <PageHeader
      eyebrow="My time"
      title="Time"
      subtitle={canTrackOtherTime ? 'Clock in, switch supervisor work categories and review your own timeline.' : 'Your own recorded visit hours. Start, pause and finish time inside each scheduled visit.'}
    />
    {message ? <Text style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    <View style={styles.metrics}>
      <TimeMetric label="Today" value={formatMinutes(Math.round(todaySeconds / 60))} icon="today-outline" />
      <TimeMetric label="Last 7 days" value={formatMinutes(Math.round(weekSeconds / 60))} icon="calendar-outline" />
    </View>

    {activeVisitRecord ? <Card style={styles.running}>
      <View style={styles.runningHead}><View style={styles.liveDot} /><Text style={styles.runningEyebrow}>VISIT IN PROGRESS</Text></View>
      <Text style={styles.runningClock}>{formatElapsed(runningElapsed)}</Text>
      <Text style={styles.runningTitle}>{activeVisitRecord.site?.client?.displayName ?? 'Active visit'}</Text>
      <Text style={styles.runningMeta}>{activeVisitRecord.site?.name ?? 'Open the visit to manage this timer.'}</Text>
      <Button title="Open active visit" onPress={() => router.push(`/visit/${activeVisitRecord.id}`)} />
    </Card> : canTrackOtherTime && runningKind ? <>
      <Card style={styles.running}>
        <View style={styles.runningHead}><View style={styles.liveDot} /><Text style={styles.runningEyebrow}>CLOCKED IN{localGeneric ? ' · OFFLINE' : ''}</Text></View>
        <Text style={styles.runningClock}>{formatElapsed(runningElapsed)}</Text>
        <Text style={styles.runningTitle}>{activityLabel(runningKind)}</Text>
        <Text style={styles.runningMeta}>Started {formatOperationalTime(activeGeneric?.startedAt ?? localGeneric!.startedAt, timezone)}</Text>
        <Button title="Clock out" variant="danger" loading={busy} onPress={() => void stop()} />
      </Card>
      <View><Text style={styles.section}>Switch activity</Text><Text style={styles.sectionSub}>Starting another category stops the current one at the same moment.</Text></View>
      <View style={styles.categories}>{categories.filter((category) => category.kind !== runningKind).map((category) => <ActivityButton key={category.kind} category={category} busy={busy} onPress={() => void start(category.kind)} />)}</View>
    </> : canTrackOtherTime ? <>
      <Card style={styles.clockInCard}>
        <View style={styles.clockInIcon}><Ionicons name="play" size={22} color="#fff" /></View>
        <View style={styles.clockInCopy}><Text style={styles.clockInTitle}>Supervisor clock</Text><Text style={styles.clockInSub}>Use General only for paid operational work outside a scheduled visit. Starting a visit later switches the timer.</Text></View>
        <Button title="Clock in" loading={busy} onPress={() => void start('general')} />
      </Card>
      <View><Text style={styles.section}>Other supervisor time</Text><Text style={styles.sectionSub}>Use a category directly when paid operational time starts with travel, office or supplies.</Text></View>
      <View style={styles.categories}>{categories.filter((category) => category.kind !== 'general' && category.kind !== 'break').map((category) => <ActivityButton key={category.kind} category={category} busy={busy} onPress={() => void start(category.kind)} />)}</View>
    </> : <Card style={styles.cleanerHint}>
      <View style={styles.cleanerHintIcon}><Ionicons name="briefcase-outline" size={20} color={colors.primary} /></View>
      <View style={styles.cleanerHintCopy}><Text style={styles.cleanerHintTitle}>Time follows your visits</Text><Text style={styles.cleanerHintText}>Open a scheduled visit to Start work, Pause, Resume or Finish. You do not need a separate General clock.</Text></View>
    </Card>}

    <View><Text style={styles.section}>Time log</Text><Text style={styles.sectionSub}>{canTrackOtherTime ? 'Your own visit and supervisor time, newest first.' : 'Your own visit work only, newest first.'}</Text></View>
    {allEntries.length ? [...allEntries].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((entry) => {
      const linkedVisit = entry.visit ?? null;
      const title = linkedVisit?.site?.client?.displayName ?? activityLabel(entry.kind as GenericKind | 'visit');
      const running = !entry.endedAt;
      return <Card key={entry.id} style={styles.entry}><View style={[styles.dot, running && styles.dotLive]} /><View style={styles.body}><Text style={styles.site}>{title}</Text><Text style={styles.meta}>{entryWindow(entry, timezone)}</Text></View><Text style={[styles.duration, running && styles.durationLive]}>{running ? formatElapsed(entrySeconds(entry, clockNow)) : formatMinutes(Math.round(entrySeconds(entry, clockNow) / 60))}</Text></Card>;
    }) : <EmptyState title="No visit time yet" body="Your recorded time appears here after you start a scheduled visit." />}
  </Screen>;
}

function ActivityButton({ category, busy, onPress }: { category: typeof categories[number]; busy: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={({ pressed }) => [styles.category, pressed && styles.pressed]}><View style={styles.categoryIcon}><Ionicons name={category.icon} size={20} color={colors.primary} /></View><Text style={styles.categoryTitle}>{category.label}</Text><Text style={styles.categoryHint}>{category.hint}</Text></Pressable>;
}

function TimeMetric({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.metric}><Ionicons name={icon} size={17} color="#AEE7D1" /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function activityLabel(kind: GenericKind | 'visit') {
  if (kind === 'visit') return 'Visit';
  if (kind === 'general') return 'General work';
  return categories.find((item) => item.kind === kind)?.label ?? 'General work';
}

function entryWindow(entry: TimeEntry, timezone: string) {
  const startDate = formatOperationalDate(entry.startedAt, timezone, { weekday: 'short', day: 'numeric', month: 'short' });
  const startTime = formatOperationalTime(entry.startedAt, timezone);
  if (!entry.endedAt) return `${startDate} · ${startTime} · Running`;
  const endDate = formatOperationalDate(entry.endedAt, timezone, { weekday: 'short', day: 'numeric', month: 'short' });
  const endTime = formatOperationalTime(entry.endedAt, timezone);
  return operationalDateKey(entry.startedAt, timezone) === operationalDateKey(entry.endedAt, timezone)
    ? `${startDate} · ${startTime}–${endTime}`
    : `${startDate} ${startTime} → ${endDate} ${endTime}`;
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':');
}

const styles = StyleSheet.create({
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' },
  metrics: { flexDirection: 'row', gap: 9 },
  metric: { flex: 1, minWidth: 0, minHeight: 92, justifyContent: 'center', padding: 12, borderRadius: 17, backgroundColor: colors.ink },
  metricValue: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: 7 },
  metricLabel: { color: '#C9D6E2', fontSize: 10, fontWeight: '700', marginTop: 2 },
  section: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  category: { width: '48%', minHeight: 108, justifyContent: 'center', padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  categoryIcon: { width: 35, height: 35, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primarySoft, marginBottom: 8 },
  categoryTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  categoryHint: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 4 },
  pressed: { opacity: .75, transform: [{ scale: .98 }] },
  running: { gap: 8, borderWidth: 1, borderColor: '#8DCDB5', backgroundColor: '#FBFEFC' },
  runningHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 99, backgroundColor: colors.success },
  runningEyebrow: { color: colors.success, fontSize: 10, fontWeight: '900', letterSpacing: .9 },
  runningClock: { color: colors.ink, fontSize: 38, lineHeight: 44, fontWeight: '900', fontVariant: ['tabular-nums'] },
  runningTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  runningMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  clockInCard: { gap: 12, borderColor: '#BFDCCF', backgroundColor: '#F7FCF9' },
  clockInIcon: { width: 44, height: 44, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  clockInCopy: { gap: 4 },
  clockInTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' },
  clockInSub: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  cleanerHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderColor: '#C9D8E2', backgroundColor: '#F8FAFC' },
  cleanerHintIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  cleanerHintCopy: { flex: 1 },
  cleanerHintTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  cleanerHintText: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 9, height: 9, borderRadius: 99, backgroundColor: '#B7C3CB' },
  dotLive: { backgroundColor: colors.success },
  body: { flex: 1, minWidth: 0 },
  site: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  duration: { color: colors.ink, fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  durationLive: { color: colors.success },
});
