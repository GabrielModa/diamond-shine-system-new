import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { cachedVisit, clearLocalTimer, enqueue, getAnyLocalTimer, getLocalTimer, hasPendingOperation, mutationId, prepareVisitForOffline, setLocalTimer, updateCachedVisit, type LocalTimer } from '@/lib/offline';
import { formatOperationalTime } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { TaskResult, TimeEntry, Visit } from '@/lib/types';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type Coordinates = { latitude: number; longitude: number; accuracyM?: number | null };
type LocationAssessment = {
  classification: 'verified' | 'near' | 'suspicious' | 'unavailable';
  distanceM: number | null;
  accuracyM: number | null;
  risk: 'verified' | 'watch' | 'review';
  reviewRequired: boolean;
  reason: string | null;
};
type StartVisitResult = TimeEntry & { location?: LocationAssessment | null };
type StopVisitResult = TimeEntry & { location?: LocationAssessment | null };

const ACTIVE_ASSIGNMENTS = new Set(['assigned', 'notified', 'seen', 'acknowledged']);

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function FlowStep({ number, label, state }: { number: string; label: string; state: 'done' | 'current' | 'next' }) {
  return <View style={styles.flowStep}>
    <View style={[styles.flowDot, state === 'done' && styles.flowDotDone, state === 'current' && styles.flowDotCurrent]}>
      <Text style={[styles.flowDotText, state !== 'next' && styles.flowDotTextActive]}>{state === 'done' ? '✓' : number}</Text>
    </View>
    <Text style={[styles.flowLabel, state === 'current' && styles.flowLabelCurrent]}>{label}</Text>
  </View>;
}

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
  const [clockNow, setClockNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    setError('');
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

  const ownAssignment = useMemo(
    () => visit?.assignments?.find((assignment) => assignment.user.email.toLowerCase() === session?.email.toLowerCase()),
    [session?.email, visit?.assignments],
  );
  const ownUserId = ownAssignment?.user.id ?? null;
  const ownEntries = useMemo(
    () => (visit?.timeEntries ?? []).filter((entry) => entry.kind === 'visit' && Boolean(ownUserId) && entry.user?.id === ownUserId),
    [ownUserId, visit?.timeEntries],
  );
  const activeEntry = useMemo(
    () => ownEntries.find((entry) => !entry.endedAt && entry.status === 'running') ?? null,
    [ownEntries],
  );
  const lastOwnCompletedEntry = useMemo(
    () => ownEntries.find((entry) => Boolean(entry.endedAt)) ?? null,
    [ownEntries],
  );
  const teamRunningEntries = useMemo(
    () => (visit?.timeEntries ?? []).filter((entry) => entry.kind === 'visit' && !entry.endedAt && entry.status === 'running'),
    [visit?.timeEntries],
  );
  const otherRunningEntries = useMemo(
    () => teamRunningEntries.filter((entry) => !ownUserId || entry.user?.id !== ownUserId),
    [ownUserId, teamRunningEntries],
  );

  const runningSince = activeEntry?.startedAt ?? localTimer?.startedAt ?? null;
  const fieldRole = session?.membershipRole === 'employee' || session?.membershipRole === 'field_supervisor';
  const canExecute = Boolean(fieldRole && ownAssignment && ACTIVE_ASSIGNMENTS.has(ownAssignment.status));
  const visitExecutionOpen = visit?.status === 'in_progress' || visit?.status === 'completion_blocked';
  const canWork = canExecute && Boolean(runningSince || visitExecutionOpen);
  const timezone = visit?.timezone ?? visit?.site.timezone ?? session?.timezone ?? 'Europe/Dublin';
  const expectedTasks = visit?.servicePlanVersion?.tasks.length ?? visit?.taskResults?.length ?? 0;
  const tasksHydrated = (visit?.taskResults?.length ?? 0) >= expectedTasks;
  const requiredDone = tasksHydrated && (visit?.taskResults?.filter((task) => task.versionTask.required).every((task) => task.status !== 'pending') ?? expectedTasks === 0);
  const ownTimerFinished = Boolean(lastOwnCompletedEntry?.endedAt);
  const visitSubmitted = visit?.status === 'completed';
  const elapsedSeconds = runningSince ? Math.max(0, Math.floor((clockNow - new Date(runningSince).getTime()) / 1000)) : 0;

  useEffect(() => {
    if (!runningSince) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);

  const canSubmitVisit = Boolean(
    canExecute
      && visitExecutionOpen
      && ownTimerFinished
      && !runningSince
      && otherRunningEntries.length === 0
      && requiredDone
      && !completionPending,
  );

  const submitHint = visitSubmitted
    ? 'This visit has been sent to Operations for review.'
    : completionPending
      ? 'Submission is saved offline and will be sent when the device reconnects.'
      : runningSince
        ? 'Stop your timer when the work is finished. Submitting the visit is a separate final step.'
        : otherRunningEntries.length
          ? `${otherRunningEntries.length} teammate${otherRunningEntries.length === 1 ? '' : 's'} still ${otherRunningEntries.length === 1 ? 'has' : 'have'} an active timer.`
          : !ownTimerFinished
            ? 'Start and stop your work timer before submitting the visit.'
            : !requiredDone
              ? 'Record every required checklist item before submitting.'
              : 'Time is recorded and required work is complete. Submit the visit for review.';

  async function withAction(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action could not be completed.');
    } finally {
      setBusy(false);
    }
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

  async function networkConnected() {
    return Boolean((await NetInfo.fetch()).isConnected);
  }

  async function startVisit() {
    if (!session || !visit || !canExecute) return;
    await withAction(async () => {
      const otherTimer = await getAnyLocalTimer();
      if (otherTimer && otherTimer.visitId !== visit.id) {
        throw new Error('Another timer is already running on this device. Stop it before starting this visit.');
      }
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
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Timer started offline. Your clock-in is queued for sync.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        const result = await apiFetch<StartVisitResult>(session, `/api/visits/${visit.id}/start`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage(locationMessage('Timer started', result.location));
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
      await apiFetch(session, `/api/visits/${visit.id}/acknowledgement`, {
        method: 'POST',
        body: JSON.stringify({ status, reason: status === 'declined' ? reason : null }),
      });
      setDeclining(false);
      setDeclineReason('');
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
        const startMutationId = localTimer?.startMutationId;
        await enqueue({
          clientMutationId,
          type: 'time.stop',
          entityId: activeEntry?.id ?? startMutationId!,
          clientCreatedAt: endedAt,
          payload: { ...payload, startMutationId, visitId: visit.id },
        });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);

        const startedAt = activeEntry?.startedAt ?? localTimer?.startedAt ?? endedAt;
        const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
        const finishedEntry: TimeEntry = activeEntry
          ? { ...activeEntry, status: 'completed', endedAt, durationSeconds }
          : {
              id: `local:${startMutationId}`,
              kind: 'visit',
              status: 'completed',
              startedAt,
              endedAt,
              durationSeconds,
              user: ownAssignment?.user,
            };
        const localVisit: Visit = {
          ...visit,
          status: 'in_progress',
          timeEntries: activeEntry
            ? (visit.timeEntries ?? []).map((entry) => entry.id === activeEntry.id ? finishedEntry : entry)
            : [finishedEntry, ...(visit.timeEntries ?? [])],
        };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Timer stopped offline. Your clock-out is queued; finish the checklist and submit when ready.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        if (!activeEntry) return saveOffline();
        const result = await apiFetch<StopVisitResult>(session, `/api/time-entries/${activeEntry.id}/stop`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage(`${locationMessage('Timer stopped', result.location)} Finish the checklist and submit the visit when ready.`);
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
        await enqueue({
          clientMutationId: mutationId('task'),
          type: 'visit.task.update',
          entityId: visit.id,
          clientCreatedAt: new Date().toISOString(),
          payload: { ...payload, versionTaskId: task.versionTask.id },
        });
        const localVisit = {
          ...visit,
          taskResults: visit.taskResults?.map((item) => item.id === task.id ? { ...item, status, note } : item),
        };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Checklist change saved offline.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        if (task.id.startsWith('local:')) return saveOffline();
        await apiFetch(session, `/api/visits/${visit.id}/tasks/${task.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
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
        await enqueue({
          clientMutationId: mutationId('incident'),
          type: 'visit.incident.create',
          entityId: visit.id,
          clientCreatedAt: new Date().toISOString(),
          payload,
        });
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
    if (!session || !visit || !canSubmitVisit) return;
    await withAction(async () => {
      const clientMutationId = mutationId('visit-complete');
      const completedAt = new Date().toISOString();
      const payload = { completedAt, clientMutationId, deviceId: await getDeviceId() };

      const saveOffline = async () => {
        await enqueue({ clientMutationId, type: 'visit.complete', entityId: visit.id, clientCreatedAt: completedAt, payload });
        setCompletionPending(true);
        setMessage('Visit submission saved offline. It will be sent to Operations when the device reconnects.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/complete`, { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Visit submitted to Operations for review.');
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
  const timerStepState = visitSubmitted || ownTimerFinished ? 'done' : 'current';
  const checklistStepState = visitSubmitted || requiredDone ? 'done' : runningSince || ownTimerFinished ? 'current' : 'next';
  const submitStepState = visitSubmitted ? 'done' : ownTimerFinished && requiredDone && !runningSince ? 'current' : 'next';
  const finishedDuration = lastOwnCompletedEntry?.durationSeconds ?? null;

  return <Screen>
    <View style={styles.hero}>
      <View style={styles.statusRow}>
        <Text style={styles.status}>{visit.status.replaceAll('_', ' ')}</Text>
        <Text style={styles.time}>{formatOperationalTime(visit.scheduledStart, timezone)}–{formatOperationalTime(visit.scheduledEnd, timezone)}</Text>
      </View>
      <Text style={styles.client}>{visit.site.client.displayName}</Text>
      <Text style={styles.job}>{visit.job?.name ?? visit.site.name}</Text>
      <Text style={styles.address}>{address}</Text>
      <Button title="Directions" variant="secondary" onPress={() => void directions()} />
    </View>

    {!canExecute ? <Card style={styles.readOnly}>
      <Text style={styles.sectionTitle}>View only</Text>
      <Text style={styles.sectionSub}>{fieldRole ? 'This visit is not actively assigned to you. Operational details are visible, but field execution actions are disabled.' : 'This role can review operational details on mobile but cannot execute cleaning work.'}</Text>
    </Card> : null}

    {visit.reopenedAt ? <Card style={styles.rework}>
      <Text style={styles.sectionTitle}>Rework requested</Text>
      <Text style={styles.sectionSub}>{visit.reopenReason ?? 'A supervisor asked for a correction before this visit can be approved.'}</Text>
      <Text style={styles.reworkMeta}>Your original completion is preserved. Add the requested proof or correction, then submit the visit again.</Text>
    </Card> : null}

    {message ? <Text style={styles.success}>{message}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

    {ownAssignment && ownAssignment.status !== 'removed' ? <Card style={[styles.assignment, ownAssignment.status === 'declined' && styles.assignmentDeclined]}>
      <View>
        <Text style={styles.timerLabel}>Schedule response</Text>
        <Text style={styles.assignmentTitle}>{ownAssignment.status === 'acknowledged' ? 'You confirmed this visit' : ownAssignment.status === 'declined' ? 'You cannot attend' : 'Can you attend this visit?'}</Text>
        {ownAssignment.declineReason ? <Text style={styles.sectionSub}>{ownAssignment.declineReason}</Text> : null}
      </View>
      {declining ? <>
        <TextInput value={declineReason} onChangeText={setDeclineReason} style={styles.input} placeholder="Reason or availability detail" multiline />
        <View style={styles.assignmentActions}>
          <Button title="Cancel" variant="ghost" compact onPress={() => setDeclining(false)} />
          <Button title="Notify operations" variant="danger" compact loading={busy} onPress={() => void respondToAssignment('declined')} />
        </View>
      </> : <View style={styles.assignmentActions}>
        {ownAssignment.status !== 'acknowledged' ? <Button title="Confirm" compact loading={busy} onPress={() => void respondToAssignment('acknowledged')} /> : null}
        <Button title={ownAssignment.status === 'declined' ? 'Change response' : "Can't attend"} variant="secondary" compact onPress={() => setDeclining(true)} />
      </View>}
    </Card> : null}

    <Card style={[styles.execution, runningSince && styles.executionRunning, ownTimerFinished && !visitSubmitted && styles.executionFinished, visitSubmitted && styles.executionSubmitted]}>
      <View style={styles.flowRow}>
        <FlowStep number="1" label="Time" state={timerStepState} />
        <View style={styles.flowLine} />
        <FlowStep number="2" label="Checklist" state={checklistStepState} />
        <View style={styles.flowLine} />
        <FlowStep number="3" label="Submit" state={submitStepState} />
      </View>

      {visitSubmitted ? <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>VISIT SUBMITTED</Text>
        <Text style={styles.executionValue}>Sent for review</Text>
        <Text style={styles.executionDetail}>Your recorded time, checklist, evidence and location events are now available to Operations.</Text>
      </View> : runningSince ? <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>TIMER RUNNING</Text>
        <Text style={styles.timerClock}>{formatElapsed(elapsedSeconds)}</Text>
        <Text style={styles.executionDetail}>Started {formatOperationalTime(runningSince, timezone)}{localTimer ? ' · offline' : ''}. Stop the timer when the cleaning work is finished.</Text>
        {canExecute ? <Button title="Stop timer" variant="secondary" loading={busy} onPress={() => void stopVisit()} /> : null}
      </View> : ownTimerFinished ? <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>TIME RECORDED</Text>
        <Text style={styles.executionValue}>{finishedDuration == null ? 'Work finished' : formatElapsed(finishedDuration)}</Text>
        <Text style={styles.executionDetail}>Clock-out is recorded. You can still finish notes, checklist items and evidence before submitting the visit.</Text>
      </View> : <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>READY TO WORK</Text>
        <Text style={styles.executionValue}>Start your timer</Text>
        <Text style={styles.executionDetail}>Starting records your clock-in and current location. It does not complete or submit the visit.</Text>
        {canExecute ? <Button title="Start timer" loading={busy} disabled={visit.status === 'completed' || completionPending} onPress={() => void startVisit()} /> : null}
      </View>}
    </Card>

    {visit.dispatchNotes ? <Card>
      <Text style={styles.sectionTitle}>Site instructions</Text>
      <Text style={styles.copy}>{visit.dispatchNotes}</Text>
    </Card> : null}

    <View style={styles.sectionHead}>
      <View>
        <Text style={styles.sectionTitle}>Cleaning checklist</Text>
        <Text style={styles.sectionSub}>{visit.taskResults?.filter((task) => task.status !== 'pending').length ?? 0}/{visit.taskResults?.length ?? 0} recorded</Text>
      </View>
      <Text style={styles.materials} onPress={() => router.push({ pathname: '/stock/[siteId]', params: { siteId: visit.site.id, visitId: visit.id } })}>Materials →</Text>
    </View>

    {visit.taskResults?.map((task) => <Card key={task.id} style={[styles.task, task.status === 'done' && styles.taskDone, task.status === 'problem' && styles.taskProblem]}>
      <View style={styles.taskHead}>
        <Text style={styles.taskTitle}>{task.versionTask.title}</Text>
        <Text style={styles.taskStatus}>{task.status.replaceAll('_', ' ')}</Text>
      </View>
      {task.versionTask.instructions ? <Text style={styles.copy}>{task.versionTask.instructions}</Text> : null}
      <TextInput editable={canWork} value={taskNotes[task.id] ?? task.note ?? ''} onChangeText={(value) => setTaskNotes((current) => ({ ...current, [task.id]: value }))} style={styles.input} placeholder="Add note or describe a problem" multiline />
      {canWork ? <>
        <View style={styles.taskActions}>
          <Pressable disabled={busy} onPress={() => void updateTask(task, 'done')} style={[styles.pill, styles.pillDone]}><Text style={styles.pillDoneText}>Done</Text></Pressable>
          <Pressable disabled={busy} onPress={() => void updateTask(task, 'problem')} style={[styles.pill, styles.pillProblem]}><Text style={styles.pillProblemText}>Problem</Text></Pressable>
          <Pressable disabled={busy} onPress={() => void updateTask(task, 'not_applicable')} style={styles.pill}><Text style={styles.pillText}>N/A</Text></Pressable>
        </View>
        <Button title={`${task.evidence?.length ? `${task.evidence.length} photo${task.evidence.length === 1 ? '' : 's'} · ` : ''}Add proof photo${task.versionTask.evidenceRequired ? ' · required' : ''}`} variant="ghost" compact onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, taskResultId: task.id, versionTaskId: task.versionTask.id, phase: 'task' } })} />
      </> : null}
    </Card>)}

    {canWork ? <Button title="Add finishing photo" variant="secondary" onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, phase: 'finish' } })} /> : null}

    {canWork ? <Card>
      <Text style={styles.sectionTitle}>Report an issue</Text>
      <Text style={styles.sectionSub}>Access, damage, safety, equipment or client problem — without WhatsApp.</Text>
      <TextInput value={incident.title} onChangeText={(title) => setIncident((current) => ({ ...current, title }))} style={styles.input} placeholder="Short issue title" />
      <TextInput value={incident.description} onChangeText={(description) => setIncident((current) => ({ ...current, description }))} style={[styles.input, styles.textarea]} placeholder="What happened and what is needed?" multiline />
      <View style={styles.severity}>
        {['low', 'medium', 'high', 'critical'].map((severity) => <Pressable key={severity} onPress={() => setIncident((current) => ({ ...current, severity }))} style={[styles.choice, incident.severity === severity && styles.choiceActive]}>
          <Text style={incident.severity === severity ? styles.choiceTextActive : styles.choiceText}>{severity}</Text>
        </Pressable>)}
      </View>
      <Button title="Send to operations" variant="secondary" disabled={!incident.title.trim() || !incident.description.trim()} loading={busy} onPress={() => void reportIncident()} />
    </Card> : null}

    {canExecute && (visitExecutionOpen || visitSubmitted || completionPending) ? <Card style={[styles.submitCard, canSubmitVisit && styles.submitCardReady, visitSubmitted && styles.submitCardDone]}>
      <Text style={styles.executionEyebrow}>{visitSubmitted ? 'DONE' : 'FINAL STEP'}</Text>
      <Text style={styles.sectionTitle}>{visitSubmitted ? 'Submitted for review' : 'Submit visit'}</Text>
      <Text style={styles.sectionSub}>{submitHint}</Text>
      {!visitSubmitted ? <Button title={completionPending ? 'Waiting to sync' : 'Submit visit'} disabled={!canSubmitVisit} loading={busy} onPress={() => void completeVisit()} /> : null}
    </Card> : null}
  </Screen>;
}

function locationMessage(action: 'Timer started' | 'Timer stopped', assessment?: LocationAssessment | null) {
  if (!assessment || assessment.classification === 'unavailable') return `${action}. GPS could not verify the site and the record will need review.`;
  const distance = assessment.distanceM == null ? 'distance unavailable' : `${assessment.distanceM}m from site`;
  const accuracy = assessment.accuracyM == null ? 'GPS accuracy unknown' : `GPS ±${assessment.accuracyM}m`;
  if (assessment.risk === 'verified') return `${action} · location verified (${distance} · ${accuracy}).`;
  if (assessment.risk === 'watch') return `${action} · location watch (${distance} · ${accuracy}).`;
  return `${action} · location needs review (${distance} · ${accuracy}).`;
}

const styles = StyleSheet.create({
  hero: { gap: 8, padding: 18, borderRadius: 20, backgroundColor: colors.ink },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
  status: { color: '#8DE1BE', fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  time: { color: '#D9E2EC', fontWeight: '700' },
  client: { color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900' },
  job: { color: '#D9E2EC', fontSize: 15, fontWeight: '700' },
  address: { color: '#B7C7D7', lineHeight: 20 },
  success: { padding: 12, borderRadius: 12, color: colors.success, fontWeight: '800', backgroundColor: colors.primarySoft },
  error: { padding: 12, borderRadius: 12, color: colors.danger, fontWeight: '700', backgroundColor: '#FDECEA' },
  readOnly: { borderColor: '#BFD0DC', backgroundColor: '#F6FAFC' },
  assignment: { borderLeftWidth: 5, borderLeftColor: colors.primary },
  assignmentDeclined: { borderLeftColor: colors.warning },
  assignmentTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 3 },
  assignmentActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  rework: { borderColor: colors.warning, backgroundColor: '#FFF8EA' },
  reworkMeta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  execution: { gap: 16 },
  executionRunning: { borderColor: '#8DCDB5', backgroundColor: '#FBFEFC' },
  executionFinished: { borderColor: '#B9C9D6', backgroundColor: '#FBFCFD' },
  executionSubmitted: { borderColor: '#A9DEC3', backgroundColor: '#F4FCF7' },
  flowRow: { flexDirection: 'row', alignItems: 'center' },
  flowStep: { alignItems: 'center', gap: 5, minWidth: 54 },
  flowDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E8EDF1', alignItems: 'center', justifyContent: 'center' },
  flowDotDone: { backgroundColor: colors.primary },
  flowDotCurrent: { backgroundColor: colors.ink },
  flowDotText: { color: colors.muted, fontSize: 10, fontWeight: '900' },
  flowDotTextActive: { color: '#fff' },
  flowLabel: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  flowLabelCurrent: { color: colors.ink },
  flowLine: { flex: 1, height: 1, marginHorizontal: 4, marginBottom: 17, backgroundColor: colors.border },
  executionCopy: { gap: 7 },
  executionEyebrow: { color: colors.primaryDark, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  executionValue: { color: colors.ink, fontSize: 23, lineHeight: 28, fontWeight: '900' },
  timerClock: { color: colors.ink, fontSize: 35, lineHeight: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  executionDetail: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  materials: { color: colors.primary, fontWeight: '800' },
  copy: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  task: { borderLeftWidth: 5, borderLeftColor: colors.border },
  taskDone: { borderLeftColor: colors.success, backgroundColor: '#FBFEFC' },
  taskProblem: { borderLeftColor: colors.danger, backgroundColor: '#FFF9F8' },
  taskHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  taskTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '800' },
  taskStatus: { color: colors.muted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  input: { minHeight: 45, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, backgroundColor: '#FBFCFD' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  taskActions: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#EEF2F5' },
  pillDone: { backgroundColor: colors.primarySoft },
  pillProblem: { backgroundColor: '#FDECEA' },
  pillText: { color: colors.muted, fontWeight: '800' },
  pillDoneText: { color: colors.success, fontWeight: '800' },
  pillProblemText: { color: colors.danger, fontWeight: '800' },
  severity: { flexDirection: 'row', gap: 6 },
  choice: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: '#EEF2F5' },
  choiceActive: { backgroundColor: colors.ink },
  choiceText: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  choiceTextActive: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  submitCard: { borderColor: '#C7D5DF', backgroundColor: '#FBFCFD' },
  submitCardReady: { borderColor: '#8DCDB5', backgroundColor: '#F4FCF7' },
  submitCardDone: { borderColor: '#A9DEC3', backgroundColor: '#F4FCF7' },
  timerLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
});
