import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import * as Location from 'expo-location';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type CheckResult = {
  assessment: {
    classification: 'verified' | 'near' | 'suspicious' | 'unavailable';
    distanceM: number | null;
    accuracyM: number | null;
    confidence: 'high' | 'medium' | 'low';
    risk: 'verified' | 'watch' | 'review';
    reviewRequired: boolean;
    reason: string | null;
  };
  geofence: { verifiedM: number; nearM: number; suspiciousM: number };
};
type RunningEntry = { id: string; kind: string; visit: { id: string } | null };

function resultCopy(result: CheckResult) {
  const { assessment } = result;
  const distance = assessment.distanceM == null ? 'Distance unavailable' : `${assessment.distanceM}m from site`;
  const accuracy = assessment.accuracyM == null ? 'GPS accuracy unknown' : `GPS ±${assessment.accuracyM}m`;
  if (assessment.risk === 'verified') return { title: 'At site', detail: `${distance} · ${accuracy}`, tone: 'verified' as const };
  if (assessment.risk === 'watch') return { title: assessment.reason === 'GPS_UNCERTAIN' ? 'GPS uncertain' : 'Near site', detail: `${distance} · ${accuracy}. You can still clock in.`, tone: 'watch' as const };
  return { title: 'Outside expected site area', detail: `${distance} · ${accuracy}. Clock-in is allowed but a similar captured check will need review.`, tone: 'review' as const };
}

export default function VisitLocationPrecheck() {
  const { session } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string }>();
  const visitId = typeof params.id === 'string' ? params.id : null;
  const onVisit = pathname.startsWith('/visit/') && Boolean(visitId);
  const [checking, setChecking] = useState(false);
  const [hasRunningTimer, setHasRunningTimer] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { setResult(null); setError(''); setHasRunningTimer(false); }, [visitId]);
  useEffect(() => {
    if (!session || !onVisit || !visitId) return;
    let disposed = false;
    const refreshTimerState = async () => {
      try {
        const entries = await apiFetch<RunningEntry[]>(session, '/api/time-entries?mine=true&status=running');
        if (!disposed) setHasRunningTimer(entries.some((entry) => entry.kind === 'visit' && entry.visit?.id === visitId));
      } catch {
        // The visit screen remains the execution source of truth if this helper cannot refresh.
      }
    };
    void refreshTimerState();
    const timer = setInterval(() => void refreshTimerState(), 10_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [onVisit, session, visitId]);

  if (!session || !onVisit || !visitId || hasRunningTimer) return null;

  async function check() {
    const activeSession = session;
    const activeVisitId = visitId;
    if (!activeSession || !activeVisitId) return;

    setChecking(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Location permission is needed to check your distance from the site.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const data = await apiFetch<CheckResult>(activeSession, `/api/visits/${activeVisitId}/location-check`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          accuracyM: current.coords.accuracy,
        }),
      });
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check your current location.');
    } finally {
      setChecking(false);
    }
  }

  const copy = result ? resultCopy(result) : null;
  return <View pointerEvents="box-none" style={styles.layer}>
    <View style={[styles.card, copy?.tone === 'verified' && styles.verified, copy?.tone === 'watch' && styles.watch, copy?.tone === 'review' && styles.review]}>
      {copy ? <View style={styles.copy}><Text style={styles.title}>{copy.title}</Text><Text style={styles.detail}>{copy.detail}</Text></View> : error ? <View style={styles.copy}><Text style={styles.title}>Location check</Text><Text style={[styles.detail, styles.error]}>{error}</Text></View> : <View style={styles.copy}><Text style={styles.title}>Before clock-in</Text><Text style={styles.detail}>Check your current distance from this site without starting the timer.</Text></View>}
      <Pressable disabled={checking} onPress={() => void check()} style={styles.button} accessibilityRole="button">
        {checking ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.buttonText}>{result ? 'Check again' : 'Check location'}</Text>}
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 14, right: 14, bottom: 18, zIndex: 1000, alignItems: 'center' },
  card: { width: '100%', maxWidth: 620, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#10251F', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 7 },
  verified: { borderColor: '#A9DEC3', backgroundColor: '#F4FCF7' },
  watch: { borderColor: '#EDD39A', backgroundColor: '#FFFBF1' },
  review: { borderColor: '#E7B7B2', backgroundColor: '#FFF7F6' },
  copy: { flex: 1, gap: 2 },
  title: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  detail: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  error: { color: colors.danger },
  button: { minWidth: 102, minHeight: 40, paddingHorizontal: 12, borderRadius: 11, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
