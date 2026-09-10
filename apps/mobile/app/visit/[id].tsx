import { Button, Card, EmptyState, Screen } from '@/components/ui';
import { ApiError, apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getDeviceId } from '@/lib/device';
import { fieldVisitState } from '@/lib/field-presentation';
import { cachedVisit, clearLocalTimer, enqueue, getAnyLocalTimer, getLocalTimer, hasPendingOperation, mutationId, prepareVisitForOffline, setLocalTimer, updateCachedVisit, type LocalTimer } from '@/lib/offline';
import { formatOperationalTime } from '@/lib/operational-time';
import { colors } from '@/lib/theme';
import type { TaskResult, TimeEntry, Visit } from '@/lib/types';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type Coordinates = { latitude: number; longitude: number; accuracyM?: number | null };
type TimerTone = 'on_track' | 'warning' | 'over';
type ActiveTimerConflictData = { id: string; visitId?: string | null; kind?: TimeEntry['kind'] };

const ACTIVE_ASSIGNMENTS = new Set(['assigned', 'notified', 'seen', 'acknowledged']);
const PENDING_ASSIGNMENTS = new Set(['assigned', 'notified', 'seen']);
const INCIDENT_CATEGORIES = ['access', 'security', 'damage', 'safety', 'equipment', 'client', 'materials', 'other'] as const;
const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function localTimerKind(timer: LocalTimer | null) {
  return timer?.startMutationId.startsWith('visit-break-') ? 'break' as const : 'visit' as const;
}

function timerConflictData(error: ApiError): ActiveTimerConflictData | null {
  if (!error.data || typeof error.data !== 'object') return null;
  const value = error.data as Record<string, unknown>;
  if (typeof value.id !== 'string') return null;
  return {
    id: value.id,
    visitId: typeof value.visitId === 'string' || value.visitId === null ? value.visitId : undefined,
    kind: typeof value.kind === 'string' ? value.kind as TimeEntry['kind'] : undefined,
  };
}

function recordedSeconds(entry: TimeEntry) {
  if (entry.durationSeconds != null) return Math.max(0, entry.durationSeconds);
  if (!entry.endedAt) return 0;
  return Math.max(0, Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000));
}

function evidencePhase(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const phase = (metadata as Record<string, unknown>).phase;
  return typeof phase === 'string' ? phase : null;
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
  const [timerConflict, setTimerConflict] = useState(false);
  const [localTimer, setLocalTimerState] = useState<LocalTimer | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incident, setIncident] = useState({ title: '', description: '', severity: 'medium', category: 'other' });
  const [finishFlowOpen, setFinishFlowOpen] = useState(false);
  const [finishStep, setFinishStep] = useState<'report' | 'report_actions' | 'photo' | 'confirm'>('report');
  const [finishFlowOffered, setFinishFlowOffered] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());

  useEffect(() => {
    setFinishFlowOpen(false);
    setFinishFlowOffered(false);
    setFinishStep('report');
  }, [id]);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    setError('');
    setTimerConflict(false);
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
  const allOwnEntries = useMemo(
    () => (visit?.timeEntries ?? []).filter((entry) => Boolean(ownUserId) && entry.user?.id === ownUserId),
    [ownUserId, visit?.timeEntries],
  );
  const ownVisitEntries = useMemo(() => allOwnEntries.filter((entry) => entry.kind === 'visit'), [allOwnEntries]);
  const activeEntry = useMemo(
    () => ownVisitEntries.find((entry) => !entry.endedAt && entry.status === 'running') ?? null,
    [ownVisitEntries],
  );
  const activeBreakEntry = useMemo(
    () => allOwnEntries.find((entry) => entry.kind === 'break' && !entry.endedAt && entry.status === 'running') ?? null,
    [allOwnEntries],
  );
  const lastOwnCompletedEntry = useMemo(
    () => ownVisitEntries.find((entry) => Boolean(entry.endedAt)) ?? null,
    [ownVisitEntries],
  );
  const teamRunningEntries = useMemo(
    () => (visit?.timeEntries ?? []).filter((entry) => !entry.endedAt && entry.status === 'running'),
    [visit?.timeEntries],
  );
  const otherRunningEntries = useMemo(
    () => teamRunningEntries.filter((entry) => !ownUserId || entry.user?.id !== ownUserId),
    [ownUserId, teamRunningEntries],
  );

  const localKind = localTimerKind(localTimer);
  const runningVisitSince = activeEntry?.startedAt ?? (localTimer && localKind === 'visit' ? localTimer.startedAt : null);
  const pausedSince = activeBreakEntry?.startedAt ?? (localTimer && localKind === 'break' ? localTimer.startedAt : null);
  const anyRunningSince = runningVisitSince ?? pausedSince;
  const paused = Boolean(pausedSince);
  const fieldRole = session?.membershipRole === 'employee' || session?.membershipRole === 'field_supervisor';
  const canExecute = Boolean(fieldRole && ownAssignment && ACTIVE_ASSIGNMENTS.has(ownAssignment.status));
  const visitExecutionOpen = visit?.status === 'in_progress' || visit?.status === 'completion_blocked';
  const canFieldAction = Boolean(canExecute && visitExecutionOpen && visit?.status !== 'completed');
  const timezone = visit?.timezone ?? visit?.site.timezone ?? session?.timezone ?? 'Europe/Dublin';
  const expectedTasks = visit?.servicePlanVersion?.tasks.length ?? visit?.taskResults?.length ?? 0;
  const tasksHydrated = (visit?.taskResults?.length ?? 0) >= expectedTasks;
  const requiredTasksDone = tasksHydrated && (visit?.taskResults?.filter((task) => task.versionTask.required).every((task) => task.status !== 'pending') ?? expectedTasks === 0);
  const requiredTaskPhotosDone = tasksHydrated && (visit?.taskResults?.filter((task) => task.versionTask.evidenceRequired).every((task) => (task.evidence?.length ?? 0) > 0) ?? true);
  const requiredDone = requiredTasksDone && requiredTaskPhotosDone;
  const ownTimerFinished = Boolean(lastOwnCompletedEntry?.endedAt);
  const visitSubmitted = visit?.status === 'completed';
  const completedWorkSeconds = ownVisitEntries.filter((entry) => Boolean(entry.endedAt)).reduce((sum, entry) => sum + recordedSeconds(entry), 0);
  const currentWorkSeconds = runningVisitSince ? Math.max(0, Math.floor((clockNow - new Date(runningVisitSince).getTime()) / 1000)) : 0;
  const workedSeconds = completedWorkSeconds + currentWorkSeconds;
  const plannedSeconds = visit ? Math.max(1, Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 1000)) : 1;
  const remainingSeconds = plannedSeconds - workedSeconds;
  const progressRatio = Math.max(0, workedSeconds / plannedSeconds);
  const progressPercent = Math.min(100, Math.round(progressRatio * 100));
  const progressWidth = `${progressPercent}%` as `${number}%`;
  const timerTone: TimerTone = progressRatio >= 1 ? 'over' : progressRatio >= 0.8 ? 'warning' : 'on_track';
  const pausedElapsedSeconds = pausedSince ? Math.max(0, Math.floor((clockNow - new Date(pausedSince).getTime()) / 1000)) : 0;
  const closeoutReady = Boolean(canExecute && visitExecutionOpen && ownTimerFinished && !runningVisitSince && !pausedSince);
  const canWorkChecklist = Boolean(closeoutReady && !visitSubmitted);
  const photos = (visit?.evidenceAssets ?? []).filter((asset) => asset.kind === 'photo');
  const finishPhotoCount = photos.filter((asset) => evidencePhase(asset.metadata) === 'finish').length;
  const evidencePolicy = visit?.job?.servicePlan?.evidencePolicy ?? null;
  const minimumPhotoCount = evidencePolicy?.minimumPhotoCount ?? 0;
  const finishPhotoMissing = Boolean(evidencePolicy?.requireFinishPhoto && finishPhotoCount === 0);
  const minimumPhotoMissing = photos.length < minimumPhotoCount;
  const visitPhotoMissing = finishPhotoMissing || minimumPhotoMissing;
  const closeoutBaseReady = Boolean(closeoutReady && otherRunningEntries.length === 0 && requiredDone);

  useEffect(() => {
    if (!anyRunningSince) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunningSince]);

  const canSubmitVisit = Boolean(closeoutBaseReady && !visitPhotoMissing && !completionPending);

  useEffect(() => {
    if (!visitSubmitted && closeoutBaseReady && !completionPending && !finishFlowOffered) {
      setFinishFlowOpen(true);
      setFinishFlowOffered(true);
    }
  }, [closeoutBaseReady, completionPending, finishFlowOffered, visitSubmitted]);

  const finishHint = completionPending
    ? 'Finish is saved offline and will be sent to Operations when the device reconnects.'
    : otherRunningEntries.length
      ? `${otherRunningEntries.length} teammate${otherRunningEntries.length === 1 ? '' : 's'} still ${otherRunningEntries.length === 1 ? 'has' : 'have'} an active timer.`
      : !requiredTasksDone
        ? 'Complete every required closeout item first.'
        : !requiredTaskPhotosDone
          ? 'A required checklist photo is still missing.'
          : visitPhotoMissing
            ? 'This service still needs its required visit photo.'
            : 'Required work is recorded. Answer two quick questions, then save the visit.';

  async function withAction(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    setTimerConflict(false);
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
      if (otherTimer && otherTimer.visitId === visit.id) {
        throw new Error(localTimerKind(otherTimer) === 'break' ? 'This visit is paused. Resume it instead.' : 'This visit timer is already running.');
      }

      const location = await coordinates();
      const deviceId = await getDeviceId();
      const switchAt = new Date().toISOString();
      const startedAt = otherTimer && otherTimer.visitId !== visit.id
        ? new Date(new Date(switchAt).getTime() + 1).toISOString()
        : switchAt;
      const clientMutationId = mutationId('visit-start');
      const payload = { ...location, capturedAt: startedAt, clientMutationId, deviceId };

      const saveOffline = async (previous?: {
        entityId: string;
        startMutationId?: string;
        localVisitId?: string;
        mode: 'finish' | 'resume';
      }) => {
        if (previous) {
          const stopMutationId = mutationId('time-switch-stop');
          await enqueue({
            clientMutationId: stopMutationId,
            type: 'time.stop',
            entityId: previous.entityId,
            clientCreatedAt: switchAt,
            payload: {
              ...location,
              capturedAt: switchAt,
              endedAt: switchAt,
              mode: previous.mode,
              ...(previous.startMutationId ? { startMutationId: previous.startMutationId } : {}),
            },
          });
          if (previous.localVisitId) await clearLocalTimer(previous.localVisitId);
        }

        await enqueue({
          clientMutationId,
          type: 'visit.start',
          entityId: visit.id,
          clientCreatedAt: startedAt,
          payload: { ...location, capturedAt: startedAt },
        });
        const timer = { visitId: visit.id, startMutationId: clientMutationId, startedAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);
        const localVisit = { ...visit, status: 'in_progress' };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage(previous
          ? 'Switched work offline. The previous timer stop and this clock-in are queued in order.'
          : 'Work started offline. Your clock-in is queued for sync.');
      };

      if (otherTimer && otherTimer.visitId !== visit.id) {
        const previousMode = localTimerKind(otherTimer) === 'break' ? 'resume' as const : 'finish' as const;
        return saveOffline({
          entityId: otherTimer.startMutationId,
          startMutationId: otherTimer.startMutationId,
          localVisitId: otherTimer.visitId,
          mode: previousMode,
        });
      }

      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/start`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('Work started.');
        await load();
      } catch (cause) {
        if (!(cause instanceof ApiError) || (cause.code !== 'ACTIVE_TIMER' && cause.code !== 'TIMER_ALREADY_RUNNING')) {
          if (!isNetworkApiError(cause)) throw cause;
          return saveOffline();
        }

        const active = timerConflictData(cause);
        if (active?.visitId === visit.id) {
          setMessage('Work is already running for this visit.');
          await load();
          return;
        }
        if (!active) {
          setTimerConflict(true);
          throw new Error('We could not identify the active timer to switch automatically. Open Time and try again.');
        }

        const stopPayload = {
          ...location,
          capturedAt: switchAt,
          endedAt: switchAt,
          mode: active.kind === 'break' ? 'resume' as const : 'finish' as const,
          clientMutationId: mutationId('time-switch-stop'),
          deviceId,
        };

        try {
          await apiFetch(session, `/api/time-entries/${active.id}/stop`, {
            method: 'POST',
            body: JSON.stringify(stopPayload),
          });
          await apiFetch(session, `/api/visits/${visit.id}/start`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setMessage('Switched work. Your previous timer stopped automatically.');
          await load();
        } catch (switchCause) {
          if (!isNetworkApiError(switchCause)) throw switchCause;
          await saveOffline({
            entityId: active.id,
            mode: active.kind === 'break' ? 'resume' : 'finish',
          });
        }
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
      setMessage(status === 'acknowledged' ? 'Visit confirmed.' : 'Operations has been notified that you cannot attend.');
      await load();
    });
  }

  function locallyFinishEntry(entry: TimeEntry | null, startMutationId: string | undefined, kind: 'visit' | 'break', endedAt: string) {
    const startedAt = entry?.startedAt ?? localTimer?.startedAt ?? endedAt;
    const durationSeconds = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
    const finishedEntry: TimeEntry = entry
      ? { ...entry, status: 'completed', endedAt, durationSeconds }
      : {
          id: `local:${startMutationId}`,
          kind,
          status: 'completed',
          startedAt,
          endedAt,
          durationSeconds,
          user: ownAssignment?.user,
        };
    return { finishedEntry, startedAt, durationSeconds };
  }

  async function pauseVisit() {
    if (!session || !visit || !canExecute || !runningVisitSince) return;
    await withAction(async () => {
      const deviceId = await getDeviceId();
      const endedAt = new Date().toISOString();
      const breakStartedAt = new Date(new Date(endedAt).getTime() + 1).toISOString();
      const stopMutationId = mutationId('time-pause');
      const breakMutationId = mutationId('visit-break');
      const stopPayload = { endedAt, mode: 'pause' as const, clientMutationId: stopMutationId, deviceId };
      const breakPayload = { kind: 'break', visitId: visit.id, startedAt: breakStartedAt, capturedAt: breakStartedAt, clientMutationId: breakMutationId, deviceId };

      const saveOffline = async () => {
        const startMutationId = localTimer?.startMutationId;
        await enqueue({
          clientMutationId: stopMutationId,
          type: 'time.stop',
          entityId: activeEntry?.id ?? startMutationId!,
          clientCreatedAt: endedAt,
          payload: { ...stopPayload, startMutationId, visitId: visit.id },
        });
        await enqueue({
          clientMutationId: breakMutationId,
          type: 'time.start',
          entityId: 'break',
          clientCreatedAt: breakStartedAt,
          payload: { visitId: visit.id, startedAt: breakStartedAt },
        });
        const timer = { visitId: visit.id, startMutationId: breakMutationId, startedAt: breakStartedAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);

        const { finishedEntry } = locallyFinishEntry(activeEntry, startMutationId, 'visit', endedAt);
        const breakEntry: TimeEntry = { id: `local:${breakMutationId}`, kind: 'break', status: 'running', startedAt: breakStartedAt, user: ownAssignment?.user };
        const entries = activeEntry
          ? (visit.timeEntries ?? []).map((entry) => entry.id === activeEntry.id ? finishedEntry : entry)
          : [finishedEntry, ...(visit.timeEntries ?? [])];
        const localVisit: Visit = { ...visit, status: 'in_progress', timeEntries: [breakEntry, ...entries] };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Work paused offline. Break time will not count as worked time.');
      };

      if (!(await networkConnected()) || !activeEntry) return saveOffline();
      try {
        await apiFetch(session, `/api/time-entries/${activeEntry.id}/stop`, { method: 'POST', body: JSON.stringify(stopPayload) });
        await apiFetch(session, '/api/time-entries', { method: 'POST', body: JSON.stringify(breakPayload) });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage('Work paused. Break time is excluded from worked hours.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function resumeVisit() {
    if (!session || !visit || !canExecute || !pausedSince) return;
    await withAction(async () => {
      const deviceId = await getDeviceId();
      const endedAt = new Date().toISOString();
      const resumedAt = new Date(new Date(endedAt).getTime() + 1).toISOString();
      const stopMutationId = mutationId('break-stop');
      const resumeMutationId = mutationId('visit-resume');
      const location = await coordinates();
      const stopPayload = { endedAt, mode: 'resume' as const, clientMutationId: stopMutationId, deviceId };
      const resumePayload = { ...location, capturedAt: resumedAt, clientMutationId: resumeMutationId, deviceId };

      const saveOffline = async () => {
        const startMutationId = localTimer?.startMutationId;
        await enqueue({
          clientMutationId: stopMutationId,
          type: 'time.stop',
          entityId: activeBreakEntry?.id ?? startMutationId!,
          clientCreatedAt: endedAt,
          payload: { ...stopPayload, startMutationId, visitId: visit.id },
        });
        await enqueue({
          clientMutationId: resumeMutationId,
          type: 'visit.start',
          entityId: visit.id,
          clientCreatedAt: resumedAt,
          payload: location ?? {},
        });
        const timer = { visitId: visit.id, startMutationId: resumeMutationId, startedAt: resumedAt };
        await setLocalTimer(timer);
        setLocalTimerState(timer);

        const { finishedEntry } = locallyFinishEntry(activeBreakEntry, startMutationId, 'break', endedAt);
        const workEntry: TimeEntry = { id: `local:${resumeMutationId}`, kind: 'visit', status: 'running', startedAt: resumedAt, user: ownAssignment?.user };
        const entries = activeBreakEntry
          ? (visit.timeEntries ?? []).map((entry) => entry.id === activeBreakEntry.id ? finishedEntry : entry)
          : [finishedEntry, ...(visit.timeEntries ?? []).filter((entry) => entry.id !== `local:${startMutationId}`)];
        const localVisit: Visit = { ...visit, status: 'in_progress', timeEntries: [workEntry, ...entries] };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Work resumed offline.');
      };

      if (!(await networkConnected()) || !activeBreakEntry) return saveOffline();
      try {
        await apiFetch(session, `/api/time-entries/${activeBreakEntry.id}/stop`, { method: 'POST', body: JSON.stringify(stopPayload) });
        await apiFetch(session, `/api/visits/${visit.id}/start`, { method: 'POST', body: JSON.stringify(resumePayload) });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage('Work resumed.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function finishWork() {
    if (!session || !visit || !canExecute || (!runningVisitSince && !pausedSince)) return;
    await withAction(async () => {
      const currentEntry = paused ? activeBreakEntry : activeEntry;
      const currentKind = paused ? 'break' as const : 'visit' as const;
      const location = await coordinates();
      const clientMutationId = mutationId('time-finish');
      const endedAt = new Date().toISOString();
      const payload = { ...location, endedAt, mode: 'finish' as const, clientMutationId, deviceId: await getDeviceId() };

      const saveOffline = async () => {
        const startMutationId = localTimer?.startMutationId;
        await enqueue({
          clientMutationId,
          type: 'time.stop',
          entityId: currentEntry?.id ?? startMutationId!,
          clientCreatedAt: endedAt,
          payload: { ...payload, startMutationId, visitId: visit.id },
        });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);

        const { finishedEntry } = locallyFinishEntry(currentEntry, startMutationId, currentKind, endedAt);
        const entries = currentEntry
          ? (visit.timeEntries ?? []).map((entry) => entry.id === currentEntry.id ? finishedEntry : entry)
          : [finishedEntry, ...(visit.timeEntries ?? []).filter((entry) => entry.id !== `local:${startMutationId}`)];
        const localVisit: Visit = { ...visit, status: 'in_progress', timeEntries: entries };
        setVisit(localVisit);
        await updateCachedVisit(localVisit);
        setMessage('Work finished offline. Your clock-out is queued; closeout is ready.');
      };

      if (!(await networkConnected()) || !currentEntry) return saveOffline();
      try {
        await apiFetch(session, `/api/time-entries/${currentEntry.id}/stop`, { method: 'POST', body: JSON.stringify(payload) });
        if (localTimer) await clearLocalTimer(visit.id);
        setLocalTimerState(null);
        setMessage('Work finished. Complete the closeout checklist when ready.');
        await load();
      } catch (cause) {
        if (!isNetworkApiError(cause)) throw cause;
        await saveOffline();
      }
    });
  }

  async function updateTask(task: TaskResult, status: TaskResult['status']) {
    if (!session || !visit || !canWorkChecklist) return;
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
    if (!session || !visit || !canFieldAction || !incident.title.trim() || !incident.description.trim()) return;
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
        setIncidentOpen(false);
        setMessage('Issue saved offline and will be sent automatically.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/incidents`, { method: 'POST', body: JSON.stringify(payload) });
        setIncident({ title: '', description: '', severity: 'medium', category: 'other' });
        setIncidentOpen(false);
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
        setFinishFlowOpen(false);
        setMessage('Visit finish saved offline. It will be sent to Operations when the device reconnects.');
      };

      if (!(await networkConnected())) return saveOffline();
      try {
        await apiFetch(session, `/api/visits/${visit.id}/complete`, { method: 'POST', body: JSON.stringify(payload) });
        setFinishFlowOpen(false);
        setMessage('Visit finished and sent to Operations.');
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
  const timerStepState = visitSubmitted || closeoutReady ? 'done' : 'current';
  const checklistStepState = visitSubmitted || requiredDone ? 'done' : closeoutReady ? 'current' : 'next';
  const doneStepState = visitSubmitted ? 'done' : closeoutBaseReady ? 'current' : 'next';
  const timerToneLabel = paused ? 'Paused' : timerTone === 'over' ? 'Over planned time' : timerTone === 'warning' ? 'Approaching planned time' : 'On track';
  const remainingLabel = remainingSeconds >= 0 ? `${formatDuration(remainingSeconds)} planned remaining` : `${formatDuration(Math.abs(remainingSeconds))} over planned time`;
  const scheduleResponseNeeded = Boolean(ownAssignment && PENDING_ASSIGNMENTS.has(ownAssignment.status) && !visitExecutionOpen && !visitSubmitted);
  const fieldState = fieldVisitState(visit, session?.email);

  return <Screen>
    <View style={styles.hero}>
      <View style={styles.statusRow}>
        <Text style={styles.status}>{fieldState.label}</Text>
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
    {timerConflict ? <Card style={styles.timerConflict}>
      <Text style={styles.sectionTitle}>Could not switch work automatically</Text>
      <Text style={styles.sectionSub}>Your existing timer was left untouched. Open Time to review it, then try starting this visit again.</Text>
      <Button title="Open Time" onPress={() => router.push('/(tabs)/timesheet')} />
    </Card> : null}

    {scheduleResponseNeeded ? <Card style={styles.assignment}>
      <View>
        <Text style={styles.timerLabel}>Schedule response</Text>
        <Text style={styles.assignmentTitle}>Can you attend this visit?</Text>
        <Text style={styles.sectionSub}>For recurring assignments, use Schedule responses to accept the ongoing schedule once.</Text>
      </View>
      {declining ? <>
        <TextInput value={declineReason} onChangeText={setDeclineReason} style={styles.input} placeholder="Reason or availability detail" multiline />
        <View style={styles.assignmentActions}>
          <Button title="Cancel" variant="ghost" compact onPress={() => setDeclining(false)} />
          <Button title="Notify operations" variant="danger" compact loading={busy} onPress={() => void respondToAssignment('declined')} />
        </View>
      </> : <View style={styles.assignmentActions}>
        <Button title="Confirm visit" compact loading={busy} onPress={() => void respondToAssignment('acknowledged')} />
        <Button title="Can't attend" variant="secondary" compact onPress={() => setDeclining(true)} />
      </View>}
    </Card> : null}

    <Card style={[
      styles.execution,
      runningVisitSince && styles.executionRunning,
      paused && styles.executionPaused,
      timerTone === 'warning' && runningVisitSince && styles.executionWarning,
      timerTone === 'over' && runningVisitSince && styles.executionOver,
      closeoutReady && !visitSubmitted && styles.executionFinished,
      visitSubmitted && styles.executionSubmitted,
    ]}>
      <View style={styles.flowRow}>
        <FlowStep number="1" label="Time" state={timerStepState} />
        <View style={styles.flowLine} />
        <FlowStep number="2" label="Closeout" state={checklistStepState} />
        <View style={styles.flowLine} />
        <FlowStep number="3" label="Done" state={doneStepState} />
      </View>

      {visitSubmitted ? <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>VISIT SUBMITTED</Text>
        <Text style={styles.executionValue}>Sent for review</Text>
        <Text style={styles.executionDetail}>Your recorded time, checklist and evidence are now available to Operations.</Text>
      </View> : runningVisitSince || pausedSince ? <View style={styles.executionCopy}>
        <View style={styles.timerStatusRow}>
          <Text style={[styles.executionEyebrow, timerTone === 'warning' && styles.warningText, timerTone === 'over' && styles.overText]}>{paused ? 'WORK PAUSED' : 'WORK IN PROGRESS'}</Text>
          <Text style={[styles.timerTone, timerTone === 'warning' && styles.warningText, timerTone === 'over' && styles.overText]}>{timerToneLabel}</Text>
        </View>
        <Text style={styles.timerClock}>{formatElapsed(workedSeconds)}</Text>
        <Text style={styles.executionDetail}>Worked · {remainingLabel}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, timerTone === 'warning' && styles.progressWarning, timerTone === 'over' && styles.progressOver, { width: progressWidth }]} /></View>
        <View style={styles.timerMetrics}>
          <View><Text style={styles.metricLabel}>Planned</Text><Text style={styles.metricValue}>{formatDuration(plannedSeconds)}</Text></View>
          <View><Text style={styles.metricLabel}>{paused ? 'Paused for' : 'Current segment'}</Text><Text style={styles.metricValue}>{formatElapsed(paused ? pausedElapsedSeconds : currentWorkSeconds)}</Text></View>
          <View><Text style={styles.metricLabel}>Window ends</Text><Text style={styles.metricValue}>{formatOperationalTime(visit.scheduledEnd, timezone)}</Text></View>
        </View>
        {paused ? <View style={styles.timerActions}>
          <View style={styles.timerAction}><Button title="Resume work" loading={busy} onPress={() => void resumeVisit()} /></View>
          <View style={styles.timerAction}><Button title="Finish work" variant="secondary" loading={busy} onPress={() => void finishWork()} /></View>
        </View> : <View style={styles.timerActions}>
          <View style={styles.timerAction}><Button title="Pause" variant="secondary" loading={busy} onPress={() => void pauseVisit()} /></View>
          <View style={styles.timerAction}><Button title="Finish work" loading={busy} onPress={() => void finishWork()} /></View>
        </View>}
        <Text style={styles.timerHint}>Pause time is excluded from worked hours. Finish work stops your timer and starts the short closeout flow.</Text>
      </View> : closeoutReady ? <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>WORK FINISHED</Text>
        <Text style={styles.executionValue}>{formatDuration(workedSeconds)} recorded</Text>
        <Text style={styles.executionDetail}>Clock-out is recorded. If Finish work was a mistake, resume now. After the required closeout items, the app will guide you through two quick finish questions.</Text>
        {!completionPending ? <Button title="Resume work" variant="secondary" loading={busy} onPress={() => void startVisit()} /> : null}
      </View> : <View style={styles.executionCopy}>
        <Text style={styles.executionEyebrow}>READY TO WORK</Text>
        <Text style={styles.executionValue}>Start work</Text>
        <Text style={styles.executionDetail}>Starting records your clock-in. If another timer is running, it will stop at the switch time. Planned time is {formatDuration(plannedSeconds)}.</Text>
        {canExecute ? <Button title="Start work" loading={busy} disabled={visit.status === 'completed' || completionPending} onPress={() => void startVisit()} /> : null}
      </View>}
    </Card>

    {visit.dispatchNotes ? <Card>
      <Text style={styles.sectionTitle}>Site instructions</Text>
      <Text style={styles.copy}>{visit.dispatchNotes}</Text>
    </Card> : null}

    {canFieldAction ? <Card style={styles.quickActions}>
      <View>
        <Text style={styles.sectionTitle}>Need something?</Text>
        <Text style={styles.sectionSub}>Report a field issue or request materials without leaving the visit context.</Text>
      </View>
      <View style={styles.quickActionRow}>
        <View style={styles.timerAction}><Button title="Report issue" variant="secondary" compact onPress={() => router.push(`/incident/${visit.id}`)} /></View>
        <View style={styles.timerAction}><Button title="Request supplies" variant="secondary" compact onPress={() => router.push({ pathname: '/stock/[siteId]', params: { siteId: visit.site.id, visitId: visit.id, mode: 'request' } })} /></View>
      </View>
    </Card> : null}

    {closeoutReady || visitSubmitted || completionPending ? <>
      <View style={styles.sectionHead}>
        <View>
          <Text style={styles.sectionTitle}>Closeout checklist</Text>
          <Text style={styles.sectionSub}>{visit.taskResults?.filter((task) => task.status !== 'pending').length ?? 0}/{visit.taskResults?.length ?? 0} recorded</Text>
        </View>
        {!visitSubmitted ? <Text style={styles.closeoutBadge}>After clock-out</Text> : null}
      </View>

      {visit.taskResults?.map((task) => <Card key={task.id} style={[styles.task, task.status === 'done' && styles.taskDone, task.status === 'problem' && styles.taskProblem]}>
        <View style={styles.taskHead}>
          <Text style={styles.taskTitle}>{task.versionTask.title}</Text>
          <Text style={styles.taskStatus}>{task.status.replaceAll('_', ' ')}</Text>
        </View>
        {task.versionTask.instructions ? <Text style={styles.copy}>{task.versionTask.instructions}</Text> : null}
        <TextInput editable={canWorkChecklist} value={taskNotes[task.id] ?? task.note ?? ''} onChangeText={(value) => setTaskNotes((current) => ({ ...current, [task.id]: value }))} style={styles.input} placeholder="Add note or describe a problem" multiline />
        {canWorkChecklist ? <>
          <View style={styles.taskActions}>
            <Pressable disabled={busy} onPress={() => void updateTask(task, 'done')} style={[styles.pill, styles.pillDone]}><Text style={styles.pillDoneText}>Done</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void updateTask(task, 'problem')} style={[styles.pill, styles.pillProblem]}><Text style={styles.pillProblemText}>Problem</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void updateTask(task, 'not_applicable')} style={styles.pill}><Text style={styles.pillText}>N/A</Text></Pressable>
          </View>
          <Button title={`${task.evidence?.length ? `${task.evidence.length} photo${task.evidence.length === 1 ? '' : 's'} · ` : ''}Add proof photo${task.versionTask.evidenceRequired ? ' · required' : ' · optional'}`} variant="ghost" compact onPress={() => router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, taskResultId: task.id, versionTaskId: task.versionTask.id, phase: 'task' } })} />
        </> : null}
      </Card>)}

    </> : null}

    {canExecute && !visitSubmitted && (closeoutBaseReady || completionPending) ? <Card style={[styles.finishCard, closeoutBaseReady && styles.finishCardReady]}>
      <Text style={styles.executionEyebrow}>{completionPending ? 'SAVED' : 'READY TO FINISH'}</Text>
      <Text style={styles.sectionTitle}>{completionPending ? 'Waiting to sync' : 'Finish visit'}</Text>
      <Text style={styles.sectionSub}>{finishHint}</Text>
      {!completionPending ? <Button title="Review & finish" loading={busy} onPress={() => { setFinishStep('report'); setFinishFlowOpen(true); }} /> : null}
    </Card> : null}

    <Modal visible={finishFlowOpen && !visitSubmitted} transparent animationType="slide" onRequestClose={() => setFinishFlowOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <View style={styles.modalHeadCopy}>
              <Text style={styles.executionEyebrow}>FINISH VISIT</Text>
              <Text style={styles.sectionTitle}>
                {finishStep === 'report' ? 'Anything Operations should know?' : finishStep === 'report_actions' ? 'What do you need to send?' : finishStep === 'photo' ? (visitPhotoMissing ? 'Closeout photo required' : 'Add a closeout photo?') : 'Ready to finish'}
              </Text>
              <Text style={styles.sectionSub}>
                {finishStep === 'report'
                  ? 'Only add something when it helps Operations act. Otherwise continue.'
                  : finishStep === 'report_actions'
                    ? 'Use the focused issue or supplies flow, then come back here automatically.'
                    : finishStep === 'photo'
                      ? visitPhotoMissing
                        ? 'This service requires photo evidence before the visit can be saved.'
                        : 'A general closeout photo is optional. Add one only when it helps show the finished area.'
                      : 'This saves the visit and sends the completed record to Operations.'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setFinishFlowOpen(false)} style={styles.modalClose}><Text style={styles.modalCloseText}>Close</Text></Pressable>
          </View>

          {finishStep === 'report' ? <View style={styles.finishFlowBody}>
            <View style={styles.finishQuestionCount}><Text>1 of 2</Text></View>
            <Button title="No, nothing to report" onPress={() => setFinishStep('photo')} />
            <Button title="Yes, I need to report something" variant="secondary" onPress={() => setFinishStep('report_actions')} />
          </View> : null}

          {finishStep === 'report_actions' ? <View style={styles.finishFlowBody}>
            <Button title="Report an issue" onPress={() => {
              setFinishStep('photo');
              setFinishFlowOpen(false);
              setFinishFlowOffered(false);
              router.push(`/incident/${visit.id}`);
            }} />
            <Button title="Request supplies" variant="secondary" onPress={() => {
              setFinishStep('photo');
              setFinishFlowOpen(false);
              setFinishFlowOffered(false);
              router.push({ pathname: '/stock/[siteId]', params: { siteId: visit.site.id, visitId: visit.id, mode: 'request' } });
            }} />
            <Button title="Nothing after all" variant="ghost" onPress={() => setFinishStep('photo')} />
          </View> : null}

          {finishStep === 'photo' ? <View style={styles.finishFlowBody}>
            <View style={styles.finishQuestionCount}><Text>2 of 2</Text></View>
            {finishPhotoCount ? <Text style={styles.finishEvidenceStatus}>{finishPhotoCount} closeout photo{finishPhotoCount === 1 ? '' : 's'} saved</Text> : null}
            <Button title={finishPhotoCount ? 'Add another photo' : 'Yes, take a photo'} onPress={() => {
              setFinishStep('confirm');
              setFinishFlowOpen(false);
              setFinishFlowOffered(false);
              router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, phase: 'finish' } });
            }} />
            {!visitPhotoMissing ? <Button title={finishPhotoCount ? 'Continue' : 'No photo'} variant="secondary" onPress={() => setFinishStep('confirm')} /> : null}
          </View> : null}

          {finishStep === 'confirm' ? <View style={styles.finishFlowBody}>
            <View style={styles.finishSummary}>
              <Text style={styles.finishSummaryTitle}>Closeout ready</Text>
              <Text style={styles.finishSummaryText}>{visitPhotoMissing ? 'Required photo evidence is still missing.' : finishPhotoCount ? `${finishPhotoCount} closeout photo${finishPhotoCount === 1 ? '' : 's'} attached.` : 'No optional closeout photo attached.'}</Text>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {visitPhotoMissing ? <Button title="Add required photo" onPress={() => {
              setFinishFlowOpen(false);
              setFinishFlowOffered(false);
              router.push({ pathname: '/camera/[visitId]', params: { visitId: visit.id, phase: 'finish' } });
            }} /> : <Button title="Save & finish" loading={busy} disabled={!canSubmitVisit} onPress={() => void completeVisit()} />}
            <Button title="Back" variant="ghost" disabled={busy} onPress={() => setFinishStep('photo')} />
          </View> : null}
        </View>
      </View>
    </Modal>

    <Modal visible={incidentOpen} transparent animationType="slide" onRequestClose={() => setIncidentOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <View style={styles.modalHeadCopy}>
              <Text style={styles.executionEyebrow}>FIELD ISSUE</Text>
              <Text style={styles.sectionTitle}>Report an issue</Text>
              <Text style={styles.sectionSub}>Access, safety, damage, equipment or client problem. Operations receives it against this visit.</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setIncidentOpen(false)} style={styles.modalClose}><Text style={styles.modalCloseText}>Close</Text></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.incidentForm}>
            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.categoryChoices}>
              {INCIDENT_CATEGORIES.map((category) => <Pressable key={category} onPress={() => setIncident((current) => ({ ...current, category }))} style={[styles.categoryChoice, incident.category === category && styles.choiceActive]}>
                <Text style={incident.category === category ? styles.choiceTextActive : styles.choiceText}>{category}</Text>
              </Pressable>)}
            </View>
            <TextInput value={incident.title} onChangeText={(title) => setIncident((current) => ({ ...current, title }))} style={styles.input} placeholder="Short issue title" />
            <TextInput value={incident.description} onChangeText={(description) => setIncident((current) => ({ ...current, description }))} style={[styles.input, styles.textarea]} placeholder="What happened and what is needed?" multiline />
            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.severity}>
              {INCIDENT_SEVERITIES.map((severity) => <Pressable key={severity} onPress={() => setIncident((current) => ({ ...current, severity }))} style={[styles.choice, incident.severity === severity && styles.choiceActive]}>
                <Text style={incident.severity === severity ? styles.choiceTextActive : styles.choiceText}>{severity}</Text>
              </Pressable>)}
            </View>
            <View style={styles.modalActions}>
              <View style={styles.timerAction}><Button title="Cancel" variant="ghost" onPress={() => setIncidentOpen(false)} /></View>
              <View style={styles.timerAction}><Button title="Send to operations" disabled={!incident.title.trim() || !incident.description.trim()} loading={busy} onPress={() => void reportIncident()} /></View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </Screen>;
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
  timerConflict: { borderColor: '#E2B15D', backgroundColor: '#FFFCF5' },
  readOnly: { borderColor: '#BFD0DC', backgroundColor: '#F6FAFC' },
  assignment: { borderLeftWidth: 5, borderLeftColor: colors.primary },
  assignmentTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 3 },
  assignmentActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  rework: { borderColor: colors.warning, backgroundColor: '#FFF8EA' },
  reworkMeta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  execution: { gap: 16 },
  executionRunning: { borderColor: '#8DCDB5', backgroundColor: '#FBFEFC' },
  executionPaused: { borderColor: '#AFC0CF', backgroundColor: '#F8FAFC' },
  executionWarning: { borderColor: '#E2B15D', backgroundColor: '#FFFCF5' },
  executionOver: { borderColor: '#E39A86', backgroundColor: '#FFF9F7' },
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
  timerClock: { color: colors.ink, fontSize: 38, lineHeight: 44, fontWeight: '900', fontVariant: ['tabular-nums'] },
  executionDetail: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  timerStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  timerTone: { color: colors.success, fontSize: 10, fontWeight: '900' },
  warningText: { color: colors.warning },
  overText: { color: colors.danger },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#E7ECEF' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.success },
  progressWarning: { backgroundColor: colors.warning },
  progressOver: { backgroundColor: colors.danger },
  timerMetrics: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 4 },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  metricValue: { color: colors.ink, fontSize: 12, fontWeight: '900', marginTop: 2 },
  timerActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  timerAction: { flex: 1 },
  timerHint: { color: colors.muted, fontSize: 10, lineHeight: 15 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  closeoutBadge: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  copy: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  quickActions: { gap: 13 },
  quickActionRow: { flexDirection: 'row', gap: 8 },
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
  categoryChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChoice: { minWidth: '22%', flexGrow: 1, paddingHorizontal: 10, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: '#EEF2F5' },
  choice: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9, backgroundColor: '#EEF2F5' },
  choiceActive: { backgroundColor: colors.ink },
  choiceText: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  choiceTextActive: { color: '#fff', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  finishCard: { borderColor: '#C7D5DF', backgroundColor: '#FBFCFD' },
  finishCardReady: { borderColor: '#8DCDB5', backgroundColor: '#F4FCF7' },
  finishFlowBody: { gap: 10 },
  finishQuestionCount: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#EEF2F5' },
  finishEvidenceStatus: { color: colors.success, fontSize: 11, fontWeight: '900' },
  finishSummary: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: '#F4F7F8' },
  finishSummaryTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  finishSummaryText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  timerLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(9, 29, 43, 0.42)' },
  modalSheet: { maxHeight: '88%', borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fff', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, gap: 14 },
  modalHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#C8D2D9', alignSelf: 'center' },
  modalHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' },
  modalHeadCopy: { flex: 1 },
  modalClose: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#EEF2F5' },
  modalCloseText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  incidentForm: { gap: 10, paddingBottom: 8 },
  fieldLabel: { color: colors.ink, fontSize: 11, fontWeight: '900', marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});
