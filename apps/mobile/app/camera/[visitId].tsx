import { Button } from '@/components/ui';
import { apiFetch, isNetworkApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { mutationId, queueEvidence } from '@/lib/offline';
import { colors } from '@/lib/theme';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function EvidenceCamera() {
  const { visitId, taskResultId, versionTaskId, phase = 'task' } = useLocalSearchParams<{ visitId: string; taskResultId?: string; versionTaskId?: string; phase?: string }>();
  const { session } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function saveOffline(id: string, uri: string) {
    await queueEvidence({
      id,
      visitId,
      taskResultId: taskResultId?.startsWith('local:') ? null : taskResultId,
      versionTaskId: versionTaskId ?? null,
      uri,
      phase,
    });
  }

  async function capture() {
    if (!camera.current || !session) return;
    setBusy(true); setError('');
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.72, skipProcessing: false });
      if (!photo?.uri) throw new Error('Photo was not captured.');
      const id = mutationId('photo');
      const network = await NetInfo.fetch();
      const dependsOnOfflineStart = Boolean(taskResultId?.startsWith('local:'));
      if (network.isConnected && !dependsOnOfflineStart) {
        try {
          const form = new FormData();
          form.append('file', { uri: photo.uri, name: `${id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
          if (taskResultId && !taskResultId.startsWith('local:')) form.append('taskResultId', taskResultId);
          else if (versionTaskId) form.append('versionTaskId', versionTaskId);
          form.append('phase', phase);
          form.append('visibility', 'client_safe');
          await apiFetch(session, `/api/visits/${visitId}/evidence-upload`, { method: 'POST', body: form });
        } catch (cause) {
          if (!isNetworkApiError(cause)) throw cause;
          await saveOffline(id, photo.uri);
        }
      } else {
        await saveOffline(id, photo.uri);
      }
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save photo.');
    } finally {
      setBusy(false);
    }
  }

  if (!permission) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!permission.granted) return <SafeAreaView style={styles.permission}><Text style={styles.permissionTitle}>Camera permission</Text><Text style={styles.permissionBody}>Use the camera for proof of service and clear issue reporting.</Text><Button title={permission.canAskAgain ? 'Allow camera' : 'Open device settings'} onPress={() => permission.canAskAgain ? void requestPermission() : void Linking.openSettings()} /><Button title="Cancel" variant="secondary" onPress={() => router.back()} /></SafeAreaView>;
  return <View style={styles.container}><CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" /><SafeAreaView style={styles.overlay}><View><Text style={styles.title}>Proof of service</Text><Text style={styles.subtitle}>Frame the completed area clearly.</Text></View>{error ? <Text style={styles.error}>{error}</Text> : null}<View style={styles.actions}><Button title="Cancel" variant="secondary" onPress={() => router.back()} /><Button title="Capture photo" loading={busy} onPress={() => void capture()} /></View></SafeAreaView></View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#000' }, overlay: { flex: 1, justifyContent: 'space-between', padding: 20, paddingTop: 24, backgroundColor: 'rgba(0,0,0,.12)' }, title: { color: '#fff', fontSize: 28, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 }, subtitle: { color: '#fff', marginTop: 5, fontWeight: '700' }, actions: { gap: 10, paddingBottom: 20 }, error: { color: '#fff', fontWeight: '800', padding: 12, borderRadius: 12, backgroundColor: 'rgba(192,57,43,.92)' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, permission: { flex: 1, justifyContent: 'center', gap: 15, padding: 24, backgroundColor: colors.canvas }, permissionTitle: { color: colors.ink, fontSize: 27, fontWeight: '900' }, permissionBody: { color: colors.muted, fontSize: 15, lineHeight: 22 } });
