import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import * as Location from 'expo-location';
import { useEffect } from 'react';
import { AppState } from 'react-native';

type RunningEntry = {
  id: string;
  kind: string;
  status: string;
  visit: { id: string } | null;
};

const PRESENCE_INTERVAL_MS = 2 * 60_000;

export default function VisitPresenceTracker() {
  const { session } = useAuth();

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let sending = false;

    const sendPresence = async () => {
      if (disposed || sending || AppState.currentState !== 'active') return;
      sending = true;
      try {
        const entries = await apiFetch<RunningEntry[]>(session, '/api/time-entries?mine=true&status=running');
        const activeVisit = entries.find((entry) => entry.kind === 'visit' && entry.visit);
        if (!activeVisit || disposed) return;

        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted' || disposed) return;
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (disposed) return;

        await apiFetch(session, `/api/time-entries/${activeVisit.id}/heartbeat`, {
          method: 'POST',
          body: JSON.stringify({
            latitude: current.coords.latitude,
            longitude: current.coords.longitude,
            accuracyM: current.coords.accuracy,
            capturedAt: new Date(current.timestamp).toISOString(),
            source: 'device',
          }),
        });
      } catch {
        // Presence is supporting evidence, never a blocker for field execution.
        // People Live will surface a stale/missing signal if checks stop arriving.
      } finally {
        sending = false;
      }
    };

    const timer = setInterval(() => void sendPresence(), PRESENCE_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sendPresence();
    });

    return () => {
      disposed = true;
      clearInterval(timer);
      subscription.remove();
    };
  }, [session]);

  return null;
}
