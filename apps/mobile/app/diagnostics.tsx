import { Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { StyleSheet, Text } from 'react-native';

export default function DiagnosticsScreen() {
  const { session, defaultServerUrl } = useAuth();
  const fields = {
    'App version': Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
    'Native build': Application.nativeBuildVersion,
    Runtime: Updates.runtimeVersion,
    Channel: Updates.channel,
    'Update ID': Updates.updateId,
    'Update created': Updates.createdAt?.toISOString(),
    Source: Updates.isEmbeddedLaunch ? 'Embedded in native build' : __DEV__ ? 'Development Metro' : 'OTA update',
    'Git identifier': process.env.EXPO_PUBLIC_GIT_SHA,
    'Current API': session?.baseUrl ?? defaultServerUrl,
  };
  return <Screen>
    <PageHeader eyebrow="About" title="Diagnostics" subtitle="Installed build, active update and server connection." />
    <Card>{Object.entries(fields).map(([label, value]) => <Text selectable key={label}>{label}: {value || 'Not available in this runtime'}</Text>)}</Card>
    <Card>
      <Text style={styles.channelEyebrow}>Work updates</Text>
      <Text style={styles.channelTitle}>Team inbox + email</Text>
      <Text style={styles.channelMessage}>Operational notices arrive in the app inbox. Managers can also email the selected recipients when publishing an important update.</Text>
      <Text style={styles.channelMeta}>Visit and shift reminders remain local notifications scheduled by this phone. Remote push is reserved for a future release.</Text>
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  channelEyebrow: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  channelTitle: { color: colors.success, fontSize: 20, lineHeight: 26, fontWeight: '900' },
  channelMessage: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  channelMeta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
