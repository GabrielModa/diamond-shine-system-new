import { Button } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { mutationId, queueEvidence } from '@/lib/offline';
import { colors } from '@/lib/theme';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

export default function EvidenceCamera() {
  const { visitId, taskResultId, phase = 'task' } = useLocalSearchParams<{ visitId: string; taskResultId?: string; phase?: string }>(); const { session } = useAuth();
  const [permission, requestPermission] = useCameraPermissions(); const camera = useRef<CameraView>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function capture() {
    if (!camera.current || !session) return; setBusy(true); setError('');
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.72, skipProcessing: false }); if (!photo?.uri) throw new Error('Photo was not captured.');
      const id = mutationId('photo'); const connected = Boolean((await NetInfo.fetch()).isConnected);
      if (connected) {
        const form = new FormData(); form.append('file', { uri: photo.uri, name: `${id}.jpg`, type: 'image/jpeg' } as unknown as Blob); if (taskResultId) form.append('taskResultId', taskResultId); form.append('phase', phase); form.append('visibility', 'client_safe');
        await apiFetch(session, `/api/visits/${visitId}/evidence-upload`, { method: 'POST', body: form });
      } else { await queueEvidence({ id, visitId, taskResultId, uri: photo.uri, phase }); }
      router.back();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save photo.'); }
    finally { setBusy(false); }
  }
  if (!permission) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (!permission.granted) return <SafeAreaView style={styles.permission}><Text style={styles.permissionTitle}>Camera permission</Text><Text style={styles.permissionBody}>Use the camera for proof of service and clear issue reporting.</Text><Button title="Allow camera" onPress={() => void requestPermission()} /><Button title="Cancel" variant="secondary" onPress={() => router.back()} /></SafeAreaView>;
  return <View style={styles.container}><CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" /><SafeAreaView style={styles.overlay}><View><Text style={styles.title}>Proof of service</Text><Text style={styles.subtitle}>Frame the completed area clearly.</Text></View>{error ? <Text style={styles.error}>{error}</Text> : null}<View style={styles.actions}><Button title="Cancel" variant="secondary" onPress={() => router.back()} /><Button title="Capture photo" loading={busy} onPress={() => void capture()} /></View></SafeAreaView></View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#000' }, overlay: { flex: 1, justifyContent: 'space-between', padding: 20, paddingTop: 50, backgroundColor: 'rgba(0,0,0,.12)' }, title: { color: '#fff', fontSize: 28, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 8 }, subtitle: { color: '#fff', marginTop: 5, fontWeight: '700' }, actions: { gap: 10, paddingBottom: 20 }, error: { color: '#fff', fontWeight: '800', padding: 12, borderRadius: 12, backgroundColor: 'rgba(192,57,43,.92)' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, permission: { flex: 1, justifyContent: 'center', gap: 15, padding: 24, backgroundColor: colors.canvas }, permissionTitle: { color: colors.ink, fontSize: 27, fontWeight: '900' }, permissionBody: { color: colors.muted, fontSize: 15, lineHeight: 22 } });
