import { apiFetch, subscribeApiMutations } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { reconcileFieldNotifications, resetFieldNotificationFingerprint } from '@/lib/field-notifications';
import type { Visit } from '@/lib/types';
import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';

const RELEVANT_MUTATION = /^\/api\/(?:visits\/|time-entries|sync|work-commitments)/;

export default function FieldNotificationPlanner() {
  const { session } = useAuth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!session) {
      resetFieldNotificationFingerprint();
      return;
    }

    let disposed = false;
    let running: Promise<void> | null = null;

    const reconcile = async () => {
      if (disposed || running) return running;
      running = (async () => {
        const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const visits = await apiFetch<Visit[]>(session, `/api/mobile/visit-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!disposed) await reconcileFieldNotifications(visits, session);
      })().catch(() => undefined).finally(() => {
        running = null;
      });
      return running;
    };

    const debounceReconcile = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Pause/resume and timer switches can perform two mutations back-to-back.
      // Reconcile once after the pair settles so reminders always reflect the
      // final timer state without adding latency to the field action itself.
      debounceRef.current = setTimeout(() => { void reconcile(); }, 450);
    };

    const task = InteractionManager.runAfterInteractions(() => { void reconcile(); });
    const unsubscribeMutation = subscribeApiMutations(({ path }) => {
      if (RELEVANT_MUTATION.test(path)) debounceReconcile();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') debounceReconcile();
    });
    // Keep tomorrow/2-hour reminders current during long-running foreground
    // sessions without coupling notification work to tab rendering.
    const interval = setInterval(() => { void reconcile(); }, 15 * 60_000);

    return () => {
      disposed = true;
      task.cancel();
      unsubscribeMutation();
      appState.remove();
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      resetFieldNotificationFingerprint();
    };
  }, [session]);

  return null;
}
