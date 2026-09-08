import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { AppState, InteractionManager } from 'react-native';
import {
  createContext,
  createElement,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
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

type VisitsContextValue = VisitSnapshot & {
  loading: boolean;
  refresh(force?: boolean): Promise<void>;
};

type CachedSnapshot = { snapshot: VisitSnapshot; savedAt: number };

const SNAPSHOT_TTL_MS = 60_000;
const EMPTY_SNAPSHOT: VisitSnapshot = { visits: [], offline: false, queued: 0, issues: 0, error: '' };
const VisitsContext = createContext<VisitsContextValue | null>(null);

let refreshInFlight: Promise<VisitSnapshot> | null = null;
let refreshKey = '';
const snapshotCache = new Map<string, CachedSnapshot>();

let persistenceScheduled = false;
let persistenceBusy = false;
let pendingPersistence: Visit[] | null = null;

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
  const delays = [0, 80, 180, 400];
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

function pumpVisitPersistence() {
  if (persistenceBusy || persistenceScheduled || !pendingPersistence) return;
  persistenceScheduled = true;
  InteractionManager.runAfterInteractions(() => {
    persistenceScheduled = false;
    const visits = pendingPersistence;
    pendingPersistence = null;
    if (!visits) return;
    persistenceBusy = true;
    void withDatabaseRetry(() => cacheVisits(visits))
      .catch(() => undefined)
      .finally(() => {
        persistenceBusy = false;
        pumpVisitPersistence();
      });
  });
}

function persistVisitsLater(visits: Visit[]) {
  // Network data can paint immediately. SQLite is the offline safety copy, so
  // coalesce rapid refreshes and write it after the navigation interaction.
  pendingPersistence = visits;
  pumpVisitPersistence();
}

async function readLocalSnapshot(): Promise<VisitSnapshot> {
  let visits: Visit[] = [];
  let queued = 0;
  let issues = 0;
  let error = '';
  try {
    [visits, queued, issues] = await Promise.all([
      withDatabaseRetry(() => cachedVisits()),
      withDatabaseRetry(() => pendingCount()),
      withDatabaseRetry(() => pendingIssueCount()),
    ]);
  } catch (cause) {
    error = friendlyDeviceError(cause);
  }
  return { visits, offline: false, queued, issues, error };
}

async function buildSnapshot(session: Session): Promise<VisitSnapshot> {
  const network = await NetInfo.fetch();
  let error = '';

  if (!network.isConnected) {
    const local = await readLocalSnapshot();
    return { ...local, offline: true };
  }

  try {
    // Most refreshes have nothing queued. Avoid device-id lookup + queue scan
    // pipeline unless there is actually work to upload.
    const pendingBeforeSync = await withDatabaseRetry(() => pendingCount()).catch(() => 0);
    if (pendingBeforeSync > 0) {
      try {
        const deviceId = await getDeviceId();
        const result = await withDatabaseRetry(() => syncPending(session, deviceId));
        if (result.issues.length) {
          error = `${result.issues.length} saved change${result.issues.length === 1 ? '' : 's'} need attention after reconnecting. Successful changes were kept.`;
        }
      } catch (cause) {
        error = friendlyDeviceError(cause);
      }
    }

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const visits = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

    // Do not make the user wait for a full SQLite rewrite before showing a
    // response that is already authoritative from the server.
    persistVisitsLater(visits);

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

    return { visits, offline: false, queued, issues, error };
  } catch (cause) {
    const memory = snapshotCache.get(sessionKey(session))?.snapshot;
    if (memory?.visits.length) {
      return { ...memory, offline: true, error: friendlyDeviceError(cause) };
    }
    const local = await readLocalSnapshot();
    return { ...local, offline: true, error: friendlyDeviceError(cause) || local.error };
  }
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

export function VisitsProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const initial = session ? freshSnapshot(session) : null;
  const [snapshot, setSnapshot] = useState<VisitSnapshot>(initial ?? EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(!initial);

  const applySnapshot = useCallback((next: VisitSnapshot) => {
    setSnapshot(next);
    setLoading(false);
  }, []);

  const refresh = useCallback(async (force = true) => {
    if (!session) return;
    const cached = !force ? freshSnapshot(session) : null;
    if (cached) {
      applySnapshot(cached);
      return;
    }
    if (!snapshot.visits.length) setLoading(true);
    applySnapshot(await sharedRefresh(session, force));
  }, [applySnapshot, session, snapshot.visits.length]);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setSnapshot(EMPTY_SNAPSHOT);
      setLoading(false);
      return;
    }

    const memory = freshSnapshot(session);
    if (memory) {
      applySnapshot(memory);
      return;
    }

    setLoading(true);
    void readLocalSnapshot().then((local) => {
      if (cancelled) return;
      // Paint the last safe offline snapshot immediately. On a first install
      // with no cache, keep the loading state until the network result arrives.
      if (local.visits.length || local.queued || local.issues || local.error) applySnapshot(local);
    });

    const task = InteractionManager.runAfterInteractions(() => {
      void sharedRefresh(session, true).then((next) => {
        if (!cancelled) applySnapshot(next);
      });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [applySnapshot, session]);

  // The tab navigator remains mounted while switching Today/Schedule/Time, so
  // this runs once for the tab workspace instead of once per screen.
  useFocusEffect(useCallback(() => {
    if (session) void refresh(false);
  }, [refresh, session]));

  useEffect(() => {
    if (!session) return;
    let initialized = false;
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (initialized && state.isConnected) void refresh(true);
      initialized = true;
    });
    return unsubscribe;
  }, [refresh, session]);

  useEffect(() => {
    if (!session) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => subscription.remove();
  }, [refresh, session]);

  const value = useMemo<VisitsContextValue>(() => ({ ...snapshot, loading, refresh }), [loading, refresh, snapshot]);
  return createElement(VisitsContext.Provider, { value }, children);
}

export function useVisits() {
  const value = useContext(VisitsContext);
  if (!value) throw new Error('useVisits must be used inside VisitsProvider');
  return value;
}
