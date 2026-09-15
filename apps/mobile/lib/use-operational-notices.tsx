import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Notice } from '@/lib/types';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

type NoticeSummary = {
  total: number;
  unread: number;
  awaitingAcknowledgement: number;
  critical: number;
};

type OperationalNoticesValue = {
  items: Notice[];
  summary: NoticeSummary;
  loading: boolean;
  error: string;
  refresh(): Promise<void>;
};

const EMPTY_SUMMARY: NoticeSummary = { total: 0, unread: 0, awaitingAcknowledgement: 0, critical: 0 };
const OperationalNoticesContext = createContext<OperationalNoticesValue | null>(null);

export function OperationalNoticesProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [items, setItems] = useState<Notice[]>([]);
  const [summary, setSummary] = useState<NoticeSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!session) {
      setItems([]);
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      setError('');
      return;
    }
    setError('');
    try {
      const data = await apiFetch<{ items: Notice[]; summary: NoticeSummary }>(session, '/api/operational-notices?scope=mine');
      setItems(data.items);
      setSummary(data.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load operational updates.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    setLoading(Boolean(session));
    void refresh();
    if (!session) return;
    const state = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    const interval = setInterval(() => { void refresh(); }, 60_000);
    return () => {
      state.remove();
      clearInterval(interval);
    };
  }, [refresh, session]);

  const value = useMemo(() => ({ items, summary, loading, error, refresh }), [error, items, loading, refresh, summary]);
  return <OperationalNoticesContext.Provider value={value}>{children}</OperationalNoticesContext.Provider>;
}

export function useOperationalNotices() {
  const value = useContext(OperationalNoticesContext);
  if (!value) throw new Error('useOperationalNotices must be used inside OperationalNoticesProvider');
  return value;
}
