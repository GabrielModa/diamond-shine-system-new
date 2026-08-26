import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { cachedVisit, clearLocalTimer, enqueue, getAnyLocalTimer, getLocalTimer, hasPendingOperation, mutationId, prepareVisitForOffline, setLocalTimer, updateCachedVisit, type LocalTimer } from '@/lib/offline';
import { formatOperationalTime } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { TaskResult, Visit } from '@/lib/types';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Coordinates = { latitude: number; longitude: number; accuracyM?: number | null };
const ACTIVE_ASSIGNMENTS = new Set(['assigned', 'notified', 'seen', 'acknowledged']);

export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [localTimer, setLocalTimerState] = useState<LocalTimer | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [incident, setIncident] = useState({ title: '', description: '', severity: 'medium', category: 'other' });

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true); setError('');
    try {
      const remote = prepareVisitForOffline(await apiFetch<Visit>(session, `/api/visits/${id}`));
      setVisit(remote);
      await updateCachedVisit(remote);
    } catch {
      setVisit(await cachedVisit(id));
      setMessage('Showing the saved offline visit.');
    } finally {
      setLocalTimerState(await getLocalTimer(id));
      setCompletionPending(await hasPendingOperation('visit.complete', id));
      setLoading(false);
    }
  }, [id, session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const activeEntry = useMemo(() => visit?.timeEntries?.find((entry) => !entry.endedAt && entry.status === 'running'), [visit]);
  const runningSince = activeEntry?.startedAt ?? localTimer?.startedAt;
  const expectedTasks = visit?.servicePlanVersion?.tasks.length ?? visit?.taskResults?.length ?? 0;
  const tasksHydrated = (visit?.taskResults?.length ?? 0) >= expectedTasks;
  const requiredDone = tasksHydrated && (visit?.taskResults?.filter((task) => task.versionTask.required).every((task) => task.status !== 'pending') ?? expectedTasks === 0);
  const ownAssignment = useMemo(() => visit?.assignments?.find((assignment) => assignment.user.email.toLowerCase() === session?.email.toLowerCase()), [session?.email, visit?.assignments]);
  const fieldRole = session?.membershipRole === 'employee' || session?.membershipRole === 'field_supervisor';
  const canExecute = Boolean(fieldRole && ownAssignment && ACTIVE_ASSIGNMENTS.has(ownAssignment.status));
  const canWork = canExecute && Boolean(runningSince || visit?.status === 'in_progress' || visit?.status === 'completion_blocked');
  const timezone = visit?.timezone ?? visit?.site.timezone ?? session?.timezone ?? 'Europe/Dublin';

  async function withAction(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action could not be completed.'); }
    finally { setBusy(false); }
  }

  async function coordinates() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { latitude: current.coords.latitude, longitude: current.coords.longitude, accuracyM: current.coords.accuracy } satisfies Coordinates;
    } catch {
      return null;
    }
  }

  async function networkConnected() { return Boolean((await NetInfo.fetch()).isConnected); }

  async function startVisit() {
    if (!session || !visit || !canExecute) return;
    await withAction(async () => {
      const otherTimer = await getAnyLocalTimer();
      if (otherTimer && otherTimer.visitId !== visit.id) throw new Error('Another timer is already running on this device. Stop it before starting this visit.');
      const location = await coordinates();
      const clientMutationId = mutationId('visit-start');
      const startedAt = new Date().toISOString();
      const payload = { ...location, capturedAt: startedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'visit.start', entityId: visit.id, clientCreatedAt: startedAt, payload: location ?? {} });
        const timer = { visitId: visit.id, startMutationId: clientMutationId, startedAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);
        const localVisit = { ...visit, status: 'in_progress' };
        setVisit(localVisit); await updateCachedVisit(localVisit);
        setMessage('Visit start saved offline and queued for sync.');
      };
      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/start`, { method: 'POST', body: JSON.stringify(payload) });
        setMessage(locationMessage(visit, location));
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function respondToAssignment(status: 'acknowledged' | 'declined') {
    if (!session || !visit) return;
    await withAction(async () => {
      const reason = declineReason.trim();
      if (status === 'declined' && !reason) throw new Error('Tell operations why you cannot attend.');
      if (!(await networkConnected())) throw new Error('Reconnect briefly to send your availability response.');
      await apiFetch(session, `/api/visits/${visit.id}/acknowledgement`, { method: 'POST', body: JSON.stringify({ status, reason: status === 'declined' ? reason : null }) });
      setDeclining(false); setDeclineReason('');
      setMessage(status === 'acknowledged' ? 'Visit confirmed. Operations can see your response.' : 'Operations has been notified that you cannot attend.');
      await load();
    });
  }

  async function stopVisit() {
    if (!session || !visit || !canExecute || (!activeEntry && !localTimer)) return;
    await withAction(async () => {
      const location = await coordinates();
      const clientMutationId = mutationId('time-stop');
      const endedAt = new Date().toISOString();
      const payload = { ...location, endedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'time.stop', entityId: activeEntry?.id ?? localTimer!.startMutationId, clientCreatedAt: endedAt, payload: { ...payload, startMutationId: localTimer?.startMutationId } });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage('Timer stop saved offline and queued for sync.');
      };
      if (!(await networkConnected())) return saveOffline();
      try {
        if (!activeEntry) return saveOffline();
        await apiFetch(session, `/api/time-entries/${activeEntry.id}/stop`, { method: 'POST', body: JSON.stringify(payload) });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage('Timer stopped and saved.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function updateTask(task: TaskResult, status: TaskResult['status']) {
    if (!session || !visit || !canWork) return;
    await withAction(async () => {
      const note = taskNotes[task.id]?.trim() || task.note || null;
      if (status === 'problem' && !note) throw new Error('Describe the problem before marking it.');
      const payload = { version: task.version, status, note };
      const saveOffline = async () => {
        await enqueue({ clientMutationId: mutationId('task'), type: 'visit.task.update', entityId: visit.id, clientCreatedAt: new Date().toISOString(), payload: { ...payload, versionTaskId: task.versionTask.id } });
        const localVisit = { ...visit, taskResults: visit.taskResults?.map((item) => item.id === task.id ? { ...item, status, note } : item) };
        setVisit(localVisit); await updateCachedVisit(localVisit);
        setMessage('Checklist change saved offline.');
      };
      if (!(await networkConnected())) return saveOffline();
      try {
        if (task.id.startsWith('local:')) return saveOffline();
        await apiFetch(session, `/api/visits/${visit.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function reportIncident() {
    if (!session || !visit || !canWork || !incident.title.trim() || !incident.description.trim()) return;
    await withAction(async () => {
      const payload = { ...incident, title: incident.title.trim(), description: incident.description.trim() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId: mutationId('incident'), type: 'visit.incident.create', entityId: visit.id, clientCreatedAt: new Date().toISOString(), payload });
        setIncident({ title: '', description: '', severity: 'medium', category: 'other' });
        setMessage('Issue saved offline and will be sent automatically.');
      };
      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/incidents`, { method: 'POST', body: JSON.stringify(payload) });
        setIncident({ title: '', description: '', severity: 'medium', category: 'other' });
        setMessage('Issue reported to operations.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function completeVisit() {
    if (!session || !visit || !canWork || completionPending) return;
    await withAction(async () => {
      if (!requiredDone) throw new Error('Record every required checklist item before completing the visit.');
      const location = await coordinates();
      const clientMutationId = mutationId('visit-complete');
      const completedAt = new Date().toISOString();
      const payload = { ...location, completedAt, clientMutationId, deviceId: await getDeviceId() };
      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'visit.complete', entityId: visit.id, clientCreatedAt: completedAt, payload: location ?? {} });
        setCompletionPending(true);
        setMessage('Completion saved offline. It will finalize only after checklist and evidence sync successfully.');
      };
      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/complete`, { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Visit completed with an auditable record.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function directions() {
    if (!visit) return;
    const address = [visit.site.addressLine1, visit.site.addressLine2, visit.site.city, visit.site.postalCode].filter(Boolean).join(', ');
    const encoded = encodeURIComponent(address);
    const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${encoded}` : `geo:0,0?q=${encoded}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    else await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
  }

  if (loading) return <Screen><ActivityIndicator size="large" color={colors.primary} /></Screen>;
  if (!visit) return <Screen><EmptyState title="Visit unavailable" body="Reconnect to download this visit before working offline." /></Screen>;
  const address = [visit.site.addressLine1, visit.site.addressLine2, visit.site.city, visit.site.postalCode].filter(Boolean).join(', ');

  return <Screen>
    <View style={styles.hero}><View style={styles.statusRow}><Text style={styles.status}>{visit.status.replaceAll('_', ' ')}</Text><Text style={styles.time}>{formatOperationalTime(visit.scheduledStart, timezone)}–{formatOperationalTime(visit.scheduledEnd, timezone)}</Text></View><Text style={styles.client}>{visit.site.client.displayName}</Text><Text style={styles.job}>{visit.job?.name ?? visit.site.name}</Text><Text style={styles.address}>{address}</Text><Button title="Directions" variant="secondary" onPress={() => void directions()} /></View>
    {!canExecute ? <Card style={styles.readOnly}><Text style={styles.sectionTitle}>View only</Text><Text style={styles.sectionSub}>{fieldRole ? 'This visit is not actively assigned to you. Operational details are visible, but field execution actions are disabled.' : 'This role can review operational details on mobile but cannot execute cleaning work.'}</Text></Card> : null}
    {visit.reopenedAt ? <Card style={styles.rework}><Text style={styles.sectionTitle}>Rework requested</Text><Text style={styles.sectionSub}>{visit.reopenReason ?? 'A supervisor asked for a correction before this visit can be approved.'}</Text><Text style={styles.reworkMeta}>Your original completion is preserved. Add the requested proof or correction, then complete the visit again.</Text></Card> : null}
    {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {ownAssignment && ownAssignment.status !== 'removed' ? <Card style={[styles.assignment, ownAssignment.status === 'declined' && styles.assignmentDeclined]}><View><Text style={styles.timerLabel}>Schedule response</Text><Text style={styles.assignmentTitle}>{ownAssignment.status === 'acknowledged' ? 'You confirmed this visit' : ownAssignment.status === 'declined' ? 'You cannot attend' : 'Can you attend this visit?'}</Text>{ownAssignment.declineReason ? <Text style={styles.sectionSub}>{ownAssignment.declineReason}</Text> : null}</View>{declining ? <><TextInput value={declineReason} onChangeText={setDeclineReason} style={styles.input} placeholder="Reason or availability detail" multiline /><View style={styles.assignmentActions}><Button title="Cancel" variant="ghost" compact onPress={() => setDeclining(false)} /><Button title="Notify operations" variant="danger" compact loading={busy} onPress={() => void respondToAssignment('declined')} /></View></> : <View style={styles.assignmentActions}>{ownAssignment.status !== 'acknowledged' ? <Button title="Confirm" compact loading={busy} onPress={() => void respondToAssignment('acknowledged')} /> : null}<Button title={ownAssignment.status === 'declined' ? 'Change response' : "Can't attend"} variant="secondary" compact onPress={() => setDeclining(true)} /></View>}</Card> : null}
    <Card style={styles.timer}><View><Text style={styles.timerLabel}>{runningSince ? 'Time on visit' : 'Visit timer'}</Text><Text style={styles.timerValue}>{runningSince ? `Started ${formatOperationalTime(runningSince, timezone)}${localTimer ? ' · offline' : ''}` : 'Ready to start'}</Text></View>{canExecute ? runningSince ? <Button title="Stop timer" variant="secondary" compact loading={busy} onPress={() => void stopVisit()} /> : <Button title="Start visit" compact loading={busy} disabled={visit.status === 'completed' || completionPending} onPress={() => void startVisit()} /> : null}</Card>
    {visit.dispatchNotes ? <Card><Text style={styles.sectionTitle}>Site instructions</Text><Text style={styles.copy}>{visit.dispatchNotes}</Text></Card> : null}
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Cleaning checklist</Text><Text style={styles.sectionSub}>{visit.taskResults?.filter((task) => task.status !== 'pending').length ?? 0}/{visit.taskResults?.length ?? 0} recorded</Text></View><Text style={styles.materials} onPress={() => router.push({ pathname: '/stock/[siteId]', params: { siteId: visit.site.id, visitId: visit.id } })}>Materials →</Text></View>
    {visit.taskResults?.map((task) => <Card key={task.id} style={[styles.task, task.status === 'done' && styles.taskDone, task.status === 'problem' && styles.taskProblem]}><View style={styles.taskHead}><Text style={styles.taskTitle}>{task.versionTask.title}</Text><Text style={styles.taskStatus}>{task.status.replaceAll('_', ' ')}</Text></View>{task.versionTask.instructions ? <Text style={styles.copy}>{task.versionTask.instructions}</Text> : null}<TextInput editable={canWork} value={taskNotes[task.id] ?? task.note ?? ''} onChangeText={(value) => setTaskNotes((current) => ({ ...current, [task.id]: value }))} style={styles.input} placeholder="Add note or describe a problem" multiline />{canWork ? <><View style={styles.taskActions}><Pressable disabled={busy} onPress={() => void updateTask(task, 'done')} style={[styles.pill, styles.pillDone]}><Text style={styles.pillDoneText}>Done</Text></Pressable><Pressable disabled={busy} onPress={() => void updateTask(task, 'problem')} style={[styles.pill, styles.pillProblem]}><Text style={styles.pillProblemText}>Problem</Text></Pressable><Pressable disabled={busy} onPress={() => void updateTask(task, 'not_applicable')} style={styles.pill}><Text style={styles.pillText}>N/A</Text></Pressable></View><Button title={`${task.evidence?.length ? `${task.evidence.length} photo${task.evidence.length === 1 ? '' : 's'} · ` : ''}Add proof photo${task.versionTask.evidenceRequired ? ' · required' : ''}`} variant="ghost" compact onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, taskResultId: task.id, versionTaskId: task.versionTask.id, phase: 'task' } })} /></> : null}</Card>)}
    {canWork ? <Button title="Add finishing photo" variant="secondary" onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, phase: 'finish' } })} /> : null}
    {canWork ? <Card><Text style={styles.sectionTitle}>Report an issue</Text><Text style={styles.sectionSub}>Access, damage, safety, equipment or client problem — without WhatsApp.</Text><TextInput value={incident.title} onChangeText={(title) => setIncident((current) => ({ ...current, title }))} style={styles.input} placeholder="Short issue title" /><TextInput value={incident.description} onChangeText={(description) => setIncident((current) => ({ ...current, description }))} style={[styles.input, styles.textarea]} placeholder="What happened and what is needed?" multiline /><View style={styles.severity}>{['low', 'medium', 'high', 'critical'].map((severity) => <Pressable key={severity} onPress={() => setIncident((current) => ({ ...current, severity }))} style={[styles.choice, incident.severity === severity && styles.choiceActive]}><Text style={incident.severity === severity ? styles.choiceTextActive : styles.choiceText}>{severity}</Text></Pressable>)}</View><Button title="Send to operations" variant="secondary" disabled={!incident.title.trim() || !incident.description.trim()} loading={busy} onPress={() => void reportIncident()} /></Card> : null}
    {canWork ? <Button title={visit.status === 'completed' ? 'Visit completed' : completionPending ? 'Completion waiting to sync' : 'Complete visit'} disabled={visit.status === 'completed' || completionPending || !requiredDone} loading={busy} onPress={() => void completeVisit()} /> : null}
    {canWork && !requiredDone && visit.status !== 'completed' ? <Text style={styles.completionHint}>Record every required checklist item before completing the visit.</Text> : null}
  </Screen>;
}

function locationMessage(visit: Visit, location: Coordinates | null) {
  if (!location || visit.site.latitude == null || visit.site.longitude == null) return 'Timer started. GPS was unavailable and was flagged for review.';
  const meters = distanceM(location, { latitude: visit.site.latitude, longitude: visit.site.longitude });
  if (meters <= (visit.site.geofenceVerifiedM ?? 150)) return `Timer started · location verified (${Math.round(meters)} m).`;
  if (meters <= (visit.site.geofenceNearM ?? 250)) return `Timer started · near the site (${Math.round(meters)} m).`;
  return `Timer started · ${Math.round(meters)} m from site and flagged for manager review.`;
}
function distanceM(a: Coordinates, b: Coordinates) { const radius = 6371000; const lat1 = a.latitude * Math.PI / 180; const lat2 = b.latitude * Math.PI / 180; const dLat = (b.latitude - a.latitude) * Math.PI / 180; const dLon = (b.longitude - a.longitude) * Math.PI / 180; const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }

const styles = StyleSheet.create({
  hero: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.ink }, statusRow: { flexDirection: 'row', justifyContent: 'space-between' }, status: { color: '#8DE1BE', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }, time: { color: '#D9E2EC', fontWeight: '700' }, client: { color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900' }, job: { color: '#D9E2EC', fontSize: 15, fontWeight: '700' }, address: { color: '#B7C7D7', lineHeight: 20 },
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft }, error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' }, timer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, timerLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' }, timerValue: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 3 },
  readOnly: { borderColor: '#BFD0DC', backgroundColor: '#F6FAFC' }, assignment: { borderLeftWidth: 5, borderLeftColor: colors.primary }, assignmentDeclined: { borderLeftColor: colors.warning }, assignmentTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 3 }, assignmentActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }, rework: { borderColor: colors.warning, backgroundColor: '#FFF8EA' }, reworkMeta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, materials: { color: colors.primary, fontWeight: '800' }, copy: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  task: { borderLeftWidth: 5, borderLeftColor: colors.border }, taskDone: { borderLeftColor: colors.success, backgroundColor: '#FBFEFC' }, taskProblem: { borderLeftColor: colors.danger, backgroundColor: '#FFF9F8' }, taskHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, taskTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '800' }, taskStatus: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' }, input: { minHeight: 45, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, backgroundColor: '#FBFCFD' }, textarea: { minHeight: 90, textAlignVertical: 'top' }, taskActions: { flexDirection: 'row', gap: 8 }, pill: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#EEF2F5' }, pillDone: { backgroundColor: colors.primarySoft }, pillProblem: { backgroundColor: '#FDECEA' }, pillText: { color: colors.muted, fontWeight: '800' }, pillDoneText: { color: colors.success, fontWeight: '800' }, pillProblemText: { color: colors.danger, fontWeight: '800' },
  severity: { flexDirection: 'row', gap: 6 }, choice: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: '#EEF2F5' }, choiceActive: { backgroundColor: colors.ink }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }, choiceTextActive: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }, completionHint: { color: colors.warning, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
