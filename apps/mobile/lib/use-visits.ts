import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';
import { getDeviceId } from './device';
import { cacheVisits, cachedVisits, pendingCount, pendingIssueCount, syncPending } from './offline';
import type { Session, Visit } from './types';

type VisitSnapshot = {
  visits: Visit[];
  offline: boolean;
  queued: number;
  issues: number;
  error: string;
};

let refreshInFlight: Promise<VisitSnapshot> | null = null;
let refreshKey = '';

function friendlyDeviceError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (/database is locked|NativeStatement\.finalizeAsync/i.test(message)) {
    return 'Saved changes are temporarily busy on this device. Try Sync now again in a moment.';
  }
  return message || 'Saved changes could not sync yet.';
}

async function buildSnapshot(session: Session): Promise<VisitSnapshot> {
  const network = await NetInfo.fetch();
  let error = '';
  let offline = false;
  let visits: Visit[] = [];

  try {
    if (network.isConnected) {
      try {
        const result = await syncPending(session, await getDeviceId());
        if (result.issues.length) {
          error = `${result.issues.length} saved change${result.issues.length === 1 ? '' : 's'} need attention after reconnecting. Successful changes were kept.`;
        }
      } catch (cause) {
        error = friendlyDeviceError(cause);
      }

      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const data = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      await cacheVisits(data);
      visits = await cachedVisits();
    } else {
      visits = await cachedVisits();
      offline = true;
    }
  } catch (cause) {
    visits = await cachedVisits();
    offline = true;
    error = friendlyDeviceError(cause) || 'Using saved visits.';
  }

  return {
    visits,
    offline,
    queued: await pendingCount(),
    issues: await pendingIssueCount(),
    error,
  };
}

function sharedRefresh(session: Session) {
  const key = `${session.organizationId}:${session.email.toLowerCase()}:${session.baseUrl}`;
  if (refreshInFlight && refreshKey === key) return refreshInFlight;

  refreshKey = key;
  const promise = buildSnapshot(session);
  refreshInFlight = promise;
  void promise.finally(() => {
    if (refreshInFlight === promise) {
      refreshInFlight = null;
      refreshKey = '';
    }
  });
  return promise;
}

export function useVisits() {
  const { session } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [issues, setIssues] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const snapshot = await sharedRefresh(session);
    setVisits(snapshot.visits);
    setOffline(snapshot.offline);
    setQueued(snapshot.queued);
    setIssues(snapshot.issues);
    setError(snapshot.error);
    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  useEffect(() => {
    if (!session) return;
    let initialized = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (initialized && state.isConnected) void refresh();
      initialized = true;
    });
    return unsubscribe;
  }, [refresh, session]);

  return { visits, loading, offline, queued, issues, error, refresh };
}
