import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';

export type WorkCommitment = {
  key: string;
  scope: 'visit' | 'recurring';
  visitId: string;
  jobId: string;
  clientName: string;
  siteName: string;
  jobName: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  recurrence: unknown;
  occurrences: number;
  reason: 'recurring_schedule' | 'visit_change';
};

type CacheValue = { data: WorkCommitment[]; savedAt: number };
const TTL_MS = 20_000;
const cache = new Map<string, CacheValue>();
const inFlight = new Map<string, Promise<WorkCommitment[]>>();

function key(organizationId: string, email: string, baseUrl: string) {
  return `${organizationId}:${email.toLowerCase()}:${baseUrl}`;
}

export function useWorkCommitments() {
  const { session } = useAuth();
  const cacheKey = session ? key(session.organizationId, session.email, session.baseUrl) : '';
  const initial = cacheKey ? cache.get(cacheKey)?.data ?? [] : [];
  const [commitments, setCommitments] = useState<WorkCommitment[]>(initial);
  const [loading, setLoading] = useState(Boolean(session) && !initial.length);
  const [error, setError] = useState('');

  const refresh = useCallback(async (force = true) => {
    if (!session) return [];
    const currentKey = key(session.organizationId, session.email, session.baseUrl);
    const cached = cache.get(currentKey);
    if (!force && cached && Date.now() - cached.savedAt < TTL_MS) {
      setCommitments(cached.data);
      setLoading(false);
      return cached.data;
    }

    setLoading((value) => value || !commitments.length);
    setError('');
    let request = inFlight.get(currentKey);
    if (!request) {
      request = apiFetch<WorkCommitment[]>(session, '/api/mobile/work-commitments');
      inFlight.set(currentKey, request);
    }
    try {
      const data = await request;
      cache.set(currentKey, { data, savedAt: Date.now() });
      setCommitments(data);
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load schedule responses.');
      return cached?.data ?? [];
    } finally {
      if (inFlight.get(currentKey) === request) inFlight.delete(currentKey);
      setLoading(false);
    }
  }, [commitments.length, session]);

  useFocusEffect(useCallback(() => { void refresh(false); }, [refresh]));

  return { commitments, loading, error, refresh };
}
