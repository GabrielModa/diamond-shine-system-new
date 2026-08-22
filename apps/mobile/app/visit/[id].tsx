import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { cachedVisit, clearLocalTimer, enqueue, getLocalTimer, mutationId, setLocalTimer, type LocalTimer } from '@/lib/offline';
import { colors } from '@/lib/theme';
import type { TaskResult, Visit } from '@/lib/types';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Coordinates = { latitude: number; longitude: number; accuracyM?: number | null };

export default function VisitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { session } = useAuth();
  const [visit, setVisit] = useState<Visit | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [localTimer, setLocalTimerState] = useState<LocalTimer | null>(null);
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({}); const [incident, setIncident] = useState({ title: '', description: '', severity: 'medium', category: 'other' });

  const load = useCallback(async () => {
    if (!session || !id) return; setLoading(true); setError('');
    try { setVisit(await apiFetch<Visit>(session, `/api/visits/${id}`)); }
    catch { setVisit(await cachedVisit(id)); setMessage('Showing the saved offline visit.'); }
    finally { setLocalTimerState(await getLocalTimer(id)); setLoading(false); }
  }, [id, session]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const activeEntry = useMemo(() => visit?.timeEntries?.find((entry) => !entry.endedAt && entry.status === 'running'), [visit]);
  const runningSince = activeEntry?.startedAt ?? localTimer?.startedAt;
  const requiredDone = visit?.taskResults?.filter((task) => task.versionTask.required).every((task) => task.status !== 'pending') ?? false;

  async function withAction(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Action could not be completed.'); } finally { setBusy(false); } }
  async function coordinates() {
    const permission = await Location.requestForegroundPermissionsAsync(); if (permission.status !== 'granted') return null;
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: current.coords.latitude, longitude: current.coords.longitude, accuracyM: current.coords.accuracy } satisfies Coordinates;
  }
  async function online() { return Boolean((await NetInfo.fetch()).isConnected); }

  async function startVisit() { if (!session || !visit) return; await withAction(async () => {
    const location = await coordinates(); const clientMutationId = mutationId('visit-start'); const payload = { ...location, clientMutationId, deviceId: await getDeviceId() };
    if (await online()) { await apiFetch(session, `/api/visits/${visit.id}/start`, { method: 'POST', body: JSON.stringify(payload) }); setMessage(locationMessage(visit, location)); await load(); }
    else { const startedAt = new Date().toISOString(); await enqueue({ clientMutationId, type: 'visit.start', entityId: visit.id, clientCreatedAt: startedAt, payload: location ?? {} }); const timer = { visitId: visit.id, startMutationId: clientMutationId, startedAt }; await setLocalTimer(timer); setLocalTimerState(timer); setMessage('Visit start saved offline and queued for sync.'); }
  }); }
  async function stopVisit() { if (!session || !visit || (!activeEntry && !localTimer)) return; await withAction(async () => {
    const location = await coordinates(); const clientMutationId = mutationId('time-stop'); const payload = { ...location, clientMutationId, deviceId: await getDeviceId() };
    if (await online() && activeEntry) { await apiFetch(session, `/api/time-entries/${activeEntry.id}/stop`, { method: 'POST', body: JSON.stringify(payload) }); await clearLocalTimer(visit.id); setLocalTimerState(null); setMessage('Timer stopped and saved.'); await load(); }
    else { const endedAt = new Date().toISOString(); await enqueue({ clientMutationId, type: 'time.stop', entityId: activeEntry?.id ?? localTimer!.startMutationId, clientCreatedAt: endedAt, payload: { ...payload, endedAt, startMutationId: localTimer?.startMutationId } }); await clearLocalTimer(visit.id); setLocalTimerState(null); setMessage('Timer stop saved offline and queued for sync.'); }
  }); }
  async function updateTask(task: TaskResult, status: TaskResult['status']) { if (!session || !visit) return; await withAction(async () => {
    const note = taskNotes[task.id]?.trim() || task.note || null; if (status === 'problem' && !note) throw new Error('Describe the problem before marking it.');
    const payload = { version: task.version, status, note };
    if (await online()) { await apiFetch(session, `/api/visits/${visit.id}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) }); await load(); }
    else { await enqueue({ clientMutationId: mutationId('task'), type: 'visit.task.update', entityId: visit.id, clientCreatedAt: new Date().toISOString(), payload: { ...payload, versionTaskId: task.versionTask.id } }); setVisit((current) => current ? { ...current, taskResults: current.taskResults?.map((item) => item.id === task.id ? { ...item, status, note } : item) } : current); setMessage('Checklist change saved offline.'); }
  }); }
  async function reportIncident() { if (!session || !visit || !incident.title.trim() || !incident.description.trim()) return; await withAction(async () => {
    const payload = { ...incident, title: incident.title.trim(), description: incident.description.trim() };
    if (await online()) { await apiFetch(session, `/api/visits/${visit.id}/incidents`, { method: 'POST', body: JSON.stringify(payload) }); setIncident({ title: '', description: '', severity: 'medium', category: 'other' }); setMessage('Issue reported to operations.'); await load(); }
    else { await enqueue({ clientMutationId: mutationId('incident'), type: 'visit.incident.create', entityId: visit.id, clientCreatedAt: new Date().toISOString(), payload }); setMessage('Issue saved offline and will be sent automatically.'); }
  }); }
  async function completeVisit() { if (!session || !visit) return; await withAction(async () => {
    const location = await coordinates(); const clientMutationId = mutationId('visit-complete'); const payload = { ...location, clientMutationId, deviceId: await getDeviceId() };
    if (await online()) { await apiFetch(session, `/api/visits/${visit.id}/complete`, { method: 'POST', body: JSON.stringify(payload) }); setMessage('Visit completed with an auditable record.'); await load(); }
    else { await enqueue({ clientMutationId, type: 'visit.complete', entityId: visit.id, clientCreatedAt: new Date().toISOString(), payload: location ?? {} }); setMessage('Completion saved offline and queued for sync.'); }
  }); }

  if (loading) return <Screen><ActivityIndicator size="large" color={colors.primary} /></Screen>;
  if (!visit) return <Screen><EmptyState title="Visit unavailable" body="Reconnect to download this visit before working offline." /></Screen>;
  const address = [visit.site.addressLine1, visit.site.addressLine2, visit.site.city, visit.site.postalCode].filter(Boolean).join(', ');
  return <Screen>
    <View style={styles.hero}><View style={styles.statusRow}><Text style={styles.status}>{visit.status.replaceAll('_', ' ')}</Text><Text style={styles.time}>{formatTime(visit.scheduledStart)}–{formatTime(visit.scheduledEnd)}</Text></View><Text style={styles.client}>{visit.site.client.displayName}</Text><Text style={styles.job}>{visit.job?.name ?? visit.site.name}</Text><Text style={styles.address}>{address}</Text><Button title="Directions" variant="secondary" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)} /></View>
    {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}{error.includes('block') && ' Review the required checklist and open issues.'}</Text> : null}
    <Card style={styles.timer}><View><Text style={styles.timerLabel}>{runningSince ? 'Time on visit' : 'Visit timer'}</Text><Text style={styles.timerValue}>{runningSince ? `Started ${formatTime(runningSince)}${localTimer ? ' · offline' : ''}` : 'Ready to start'}</Text></View>{runningSince ? <Button title="Stop timer" variant="secondary" compact loading={busy} onPress={() => void stopVisit()} /> : <Button title="Start visit" compact loading={busy} disabled={visit.status === 'completed'} onPress={() => void startVisit()} />}</Card>
    {visit.dispatchNotes ? <Card><Text style={styles.sectionTitle}>Site instructions</Text><Text style={styles.copy}>{visit.dispatchNotes}</Text></Card> : null}
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Cleaning checklist</Text><Text style={styles.sectionSub}>{visit.taskResults?.filter((task) => task.status !== 'pending').length ?? 0}/{visit.taskResults?.length ?? 0} recorded</Text></View><Text style={styles.materials} onPress={() => router.push({ pathname: '/stock/[siteId]', params: { siteId: visit.site.id, visitId: visit.id } })}>Materials →</Text></View>
    {visit.taskResults?.map((task) => <Card key={task.id} style={[styles.task, task.status === 'done' && styles.taskDone, task.status === 'problem' && styles.taskProblem]}><View style={styles.taskHead}><Text style={styles.taskTitle}>{task.versionTask.title}</Text><Text style={styles.taskStatus}>{task.status.replaceAll('_', ' ')}</Text></View>{task.versionTask.instructions ? <Text style={styles.copy}>{task.versionTask.instructions}</Text> : null}<TextInput value={taskNotes[task.id] ?? task.note ?? ''} onChangeText={(value) => setTaskNotes((current) => ({ ...current, [task.id]: value }))} style={styles.input} placeholder="Add note or describe a problem" multiline /><View style={styles.taskActions}><Pressable disabled={busy} onPress={() => void updateTask(task, 'done')} style={[styles.pill, styles.pillDone]}><Text style={styles.pillDoneText}>Done</Text></Pressable><Pressable disabled={busy} onPress={() => void updateTask(task, 'problem')} style={[styles.pill, styles.pillProblem]}><Text style={styles.pillProblemText}>Problem</Text></Pressable><Pressable disabled={busy} onPress={() => void updateTask(task, 'not_applicable')} style={styles.pill}><Text style={styles.pillText}>N/A</Text></Pressable></View><Button title={`${task.evidence?.length ? `${task.evidence.length} photo${task.evidence.length === 1 ? '' : 's'} · ` : ''}Add proof photo${task.versionTask.evidenceRequired ? ' · required' : ''}`} variant="ghost" compact onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, taskResultId: task.id, phase: 'task' } })} /></Card>)}
    <Button title="Add finishing photo" variant="secondary" onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, phase: 'finish' } })} />
    <Card><Text style={styles.sectionTitle}>Report an issue</Text><Text style={styles.sectionSub}>Access, damage, safety, equipment or client problem — without WhatsApp.</Text><TextInput value={incident.title} onChangeText={(title) => setIncident((current) => ({ ...current, title }))} style={styles.input} placeholder="Short issue title" /><TextInput value={incident.description} onChangeText={(description) => setIncident((current) => ({ ...current, description }))} style={[styles.input, styles.textarea]} placeholder="What happened and what is needed?" multiline /><View style={styles.severity}>{['low', 'medium', 'high', 'critical'].map((severity) => <Pressable key={severity} onPress={() => setIncident((current) => ({ ...current, severity }))} style={[styles.choice, incident.severity === severity && styles.choiceActive]}><Text style={incident.severity === severity ? styles.choiceTextActive : styles.choiceText}>{severity}</Text></Pressable>)}</View><Button title="Send to operations" variant="secondary" disabled={!incident.title.trim() || !incident.description.trim()} loading={busy} onPress={() => void reportIncident()} /></Card>
    <Button title={visit.status === 'completed' ? 'Visit completed' : 'Complete visit'} disabled={visit.status === 'completed' || !requiredDone} loading={busy} onPress={() => void completeVisit()} />
    {!requiredDone && visit.status !== 'completed' ? <Text style={styles.completionHint}>Record every required checklist item before completing the visit.</Text> : null}
  </Screen>;
}

function locationMessage(visit: Visit, location: Coordinates | null) { if (!location || visit.site.latitude == null || visit.site.longitude == null) return 'Timer started. GPS was unavailable and was flagged for review.'; const meters = distanceM(location, { latitude: visit.site.latitude, longitude: visit.site.longitude }); if (meters <= (visit.site.geofenceVerifiedM ?? 150)) return `Timer started · location verified (${Math.round(meters)} m).`; if (meters <= (visit.site.geofenceNearM ?? 250)) return `Timer started · near the site (${Math.round(meters)} m).`; return `Timer started · ${Math.round(meters)} m from site and flagged for manager review.`; }
function distanceM(a: Coordinates, b: Coordinates) { const radius = 6371000; const lat1 = a.latitude * Math.PI / 180; const lat2 = b.latitude * Math.PI / 180; const dLat = (b.latitude - a.latitude) * Math.PI / 180; const dLon = (b.longitude - a.longitude) * Math.PI / 180; const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2; return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-IE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }

const styles = StyleSheet.create({
  hero: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.ink }, statusRow: { flexDirection: 'row', justifyContent: 'space-between' }, status: { color: '#8DE1BE', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }, time: { color: '#D9E2EC', fontWeight: '700' }, client: { color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900' }, job: { color: '#D9E2EC', fontSize: 15, fontWeight: '700' }, address: { color: '#B7C7D7', lineHeight: 20 },
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft }, error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' }, timer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, timerLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' }, timerValue: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 3 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, materials: { color: colors.primary, fontWeight: '800' }, copy: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  task: { borderLeftWidth: 5, borderLeftColor: colors.border }, taskDone: { borderLeftColor: colors.success, backgroundColor: '#FBFEFC' }, taskProblem: { borderLeftColor: colors.danger, backgroundColor: '#FFF9F8' }, taskHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, taskTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '800' }, taskStatus: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' }, input: { minHeight: 45, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, backgroundColor: '#FBFCFD' }, textarea: { minHeight: 90, textAlignVertical: 'top' }, taskActions: { flexDirection: 'row', gap: 8 }, pill: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#EEF2F5' }, pillDone: { backgroundColor: colors.primarySoft }, pillProblem: { backgroundColor: '#FDECEA' }, pillText: { color: colors.muted, fontWeight: '800' }, pillDoneText: { color: colors.success, fontWeight: '800' }, pillProblemText: { color: colors.danger, fontWeight: '800' },
  severity: { flexDirection: 'row', gap: 6 }, choice: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: '#EEF2F5' }, choiceActive: { backgroundColor: colors.ink }, choiceText: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }, choiceTextActive: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' }, completionHint: { color: colors.warning, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
