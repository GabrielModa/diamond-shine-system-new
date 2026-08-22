import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';
import { getDeviceId } from './device';
import { cacheVisits, cachedVisits, pendingCount, syncPending } from './offline';
import type { Visit } from './types';

export function useVisits() {
  const { session } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [queued, setQueued] = useState(0); const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError('');
    const network = await NetInfo.fetch();
    try {
      if (network.isConnected) {
        await syncPending(session, await getDeviceId()).catch(() => null);
        const from = new Date(Date.now() - 86_400_000).toISOString(); const to = new Date(Date.now() + 14 * 86_400_000).toISOString();
        const data = await apiFetch<Visit[]>(session, `/api/sync?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        await cacheVisits(data); setVisits(data); setOffline(false);
      } else { setVisits(await cachedVisits()); setOffline(true); }
    } catch (cause) { setVisits(await cachedVisits()); setOffline(true); setError(cause instanceof Error ? cause.message : 'Using saved visits.'); }
    finally { setQueued(await pendingCount()); setLoading(false); }
  }, [session]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { visits, loading, offline, queued, error, refresh };
}
