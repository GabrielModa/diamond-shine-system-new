import { Button, Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { StyleSheet, Text, View } from 'react-native';

const pushStatusLabel = {
  idle: 'Waiting to register',
  registering: 'Registering…',
  registered: 'Registered',
  unavailable: 'Unavailable',
  permission_denied: 'Permission required',
  error: 'Needs attention',
} as const;

export default function DiagnosticsScreen() {
  const { session, defaultServerUrl, pushRegistration, retryPushRegistration } = useAuth();
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
  const pushTone = pushRegistration.status === 'registered'
    ? styles.pushSuccess
    : pushRegistration.status === 'error' || pushRegistration.status === 'permission_denied'
      ? styles.pushError
      : styles.pushNeutral;
  return <Screen>
    <PageHeader eyebrow="About" title="Diagnostics" subtitle="Installed build, active update and server connection." />
    <Card>{Object.entries(fields).map(([label, value]) => <Text selectable key={label}>{label}: {value || 'Not available in this runtime'}</Text>)}</Card>
    <Card>
      <View style={styles.pushHeading}>
        <View style={styles.pushCopy}>
          <Text style={styles.pushEyebrow}>Remote notifications</Text>
          <Text style={[styles.pushStatus, pushTone]}>{pushStatusLabel[pushRegistration.status]}</Text>
        </View>
      </View>
      <Text style={styles.pushMessage}>{pushRegistration.message}</Text>
      {pushRegistration.stage ? <Text selectable style={styles.pushMeta}>Stage: {pushRegistration.stage}</Text> : null}
      {pushRegistration.detail ? <Text selectable style={styles.pushDetail}>Technical detail: {pushRegistration.detail}</Text> : null}
      {pushRegistration.lastAttemptAt ? <Text style={styles.pushMeta}>Last attempt: {new Date(pushRegistration.lastAttemptAt).toLocaleString()}</Text> : null}
      <Button
        title={pushRegistration.status === 'registered' ? 'Refresh registration' : 'Retry push registration'}
        variant="secondary"
        loading={pushRegistration.status === 'registering'}
        disabled={!session}
        onPress={() => { void retryPushRegistration(); }}
      />
    </Card>
  </Screen>;
}

const styles = StyleSheet.create({
  pushHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pushCopy: { flex: 1, gap: 3 },
  pushEyebrow: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  pushStatus: { fontSize: 20, lineHeight: 26, fontWeight: '900' },
  pushSuccess: { color: colors.success },
  pushError: { color: colors.danger },
  pushNeutral: { color: colors.ink },
  pushMessage: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  pushMeta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  pushDetail: { color: colors.danger, backgroundColor: '#FDF2F0', borderRadius: 10, padding: 10, fontSize: 12, lineHeight: 18 },
});
