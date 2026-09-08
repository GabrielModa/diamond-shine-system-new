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

type CachedSnapshot = { snapshot: VisitSnapshot; savedAt: number };

const SNAPSHOT_TTL_MS = 20_000;
let refreshInFlight: Promise<VisitSnapshot> | null = null;
let refreshKey = '';
const snapshotCache = new Map<string, CachedSnapshot>();

function sessionKey(session: Session) {
  return `${session.organizationId}:${session.email.toLowerCase()}:${session.baseUrl}`;
}

function freshSnapshot(session: Session) {
  const cached = snapshotCache.get(sessionKey(session));
  return cached && Date.now() - cached.savedAt < SNAPSHOT_TTL_MS ? cached.snapshot : null;
}

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
        const deviceId = await getDeviceId();
        const result = await withDatabaseRetry(() => syncPending(session, deviceId));
        if (result.issues.length) {
          error = `${result.issues.length} saved change${result.issues.length === 1 ? '' : 's'} need attention after reconnecting. Successful changes were kept.`;
        }
      } catch (cause) {
        error = friendlyDeviceError(cause);
      }

      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const data = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      // The network response is already the canonical snapshot. Persist it for
      // offline use, but do not immediately read the same large payload back
      // out of SQLite before painting the screen.
      visits = data;
      await withDatabaseRetry(() => cacheVisits(data));
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

function sharedRefresh(session: Session, force = false) {
  const key = sessionKey(session);
  const cached = !force ? freshSnapshot(session) : null;
  if (cached) return Promise.resolve(cached);
  if (refreshInFlight && refreshKey === key) return refreshInFlight;

  refreshKey = key;
  const promise = buildSnapshot(session).then((snapshot) => {
    snapshotCache.set(key, { snapshot, savedAt: Date.now() });
    return snapshot;
  });
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
  const initial = session ? freshSnapshot(session) : null;
  const [visits, setVisits] = useState<Visit[]>(initial?.visits ?? []);
  const [loading, setLoading] = useState(!initial);
  const [offline, setOffline] = useState(initial?.offline ?? false);
  const [queued, setQueued] = useState(initial?.queued ?? 0);
  const [issues, setIssues] = useState(initial?.issues ?? 0);
  const [error, setError] = useState(initial?.error ?? '');

  const refresh = useCallback(async (force = true) => {
    if (!session) return;
    const cached = !force ? freshSnapshot(session) : null;
    if (!cached && !visits.length) setLoading(true);
    const snapshot = cached ?? await sharedRefresh(session, force);
    setVisits(snapshot.visits);
    setOffline(snapshot.offline);
    setQueued(snapshot.queued);
    setIssues(snapshot.issues);
    setError(snapshot.error);
    setLoading(false);
  }, [session, visits.length]);

  // Tab changes are not a reason to download and rewrite the whole offline
  // package again. A fresh snapshot is shared for a short period; explicit
  // refresh buttons still force a real sync.
  useFocusEffect(useCallback(() => { void refresh(false); }, [refresh]));
  useEffect(() => {
    if (!session) return;
    let initialized = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (initialized && state.isConnected) void refresh(true);
      initialized = true;
    });
    return unsubscribe;
  }, [refresh, session]);

  return { visits, loading, offline, queued, issues, error, refresh };
}
