import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';
import { getDeviceId } from './device';
import { cacheVisits, cachedVisits, pendingCount, pendingIssueCount, syncPending } from './offline';
import type { Visit } from './types';

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
    setLoading(true); setError('');
    const network = await NetInfo.fetch();
    try {
      if (network.isConnected) {
        let syncMessage = '';
        try {
          const result = await syncPending(session, await getDeviceId());
          if (result.issues.length) {
            syncMessage = `${result.issues.length} saved change${result.issues.length === 1 ? '' : 's'} need attention after reconnecting. Successful changes were kept.`;
          }
        } catch (cause) {
          syncMessage = cause instanceof Error ? `Saved changes could not sync yet: ${cause.message}` : 'Saved changes could not sync yet.';
        }

        const from = new Date(Date.now() - 86_400_000).toISOString();
        const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
        const data = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        await cacheVisits(data);
        setVisits(await cachedVisits());
        setOffline(false);
        setError(syncMessage);
      } else {
        setVisits(await cachedVisits());
        setOffline(true);
      }
    } catch (cause) {
      setVisits(await cachedVisits());
      setOffline(true);
      setError(cause instanceof Error ? cause.message : 'Using saved visits.');
    } finally {
      setQueued(await pendingCount());
      setIssues(await pendingIssueCount());
      setLoading(false);
    }
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
