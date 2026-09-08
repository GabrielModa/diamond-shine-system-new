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

function databaseBusy(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  return /database is locked|NativeStatement\.finalizeAsync/i.test(message);
}

function friendlyDeviceError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (databaseBusy(cause)) {
    return 'Saved changes are temporarily busy on this device. We will retry automatically.';
  }
  return message || 'Saved changes could not sync yet.';
}

async function withDatabaseRetry<T>(action: () => Promise<T>) {
  const delays = [0, 120, 300, 650];
  let lastError: unknown;
  for (const delayMs of delays) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      return await action();
    } catch (cause) {
      lastError = cause;
      if (!databaseBusy(cause)) throw cause;
    }
  }
  throw lastError;
}

async function buildSnapshot(session: Session): Promise<VisitSnapshot> {
  const network = await NetInfo.fetch();
  let error = '';
  let offline = false;
  let visits: Visit[] = [];

  try {
    if (network.isConnected) {
      try {
        const result = await withDatabaseRetry(() => syncPending(session, getDeviceId()));
        if (result.issues.length) {
          error = `${result.issues.length} saved change${result.issues.length === 1 ? '' : 's'} need attention after reconnecting. Successful changes were kept.`;
        }
      } catch (cause) {
        error = friendlyDeviceError(cause);
      }

      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const data = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      await withDatabaseRetry(() => cacheVisits(data));
      visits = await withDatabaseRetry(() => cachedVisits());
    } else {
      visits = await withDatabaseRetry(() => cachedVisits());
      offline = true;
    }
  } catch (cause) {
    try {
      visits = await withDatabaseRetry(() => cachedVisits());
    } catch {
      visits = [];
    }
    offline = true;
    error = friendlyDeviceError(cause) || 'Using saved visits.';
  }

  let queued = 0;
  let issues = 0;
  try {
    [queued, issues] = await Promise.all([
      withDatabaseRetry(() => pendingCount()),
      withDatabaseRetry(() => pendingIssueCount()),
    ]);
  } catch (cause) {
    if (!error) error = friendlyDeviceError(cause);
  }

  return { visits, offline, queued, issues, error };
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
