import { Card, PageHeader, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Text } from 'react-native';

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
  return <Screen><PageHeader eyebrow="About" title="Diagnostics" subtitle="Installed build, active update and server connection." /><Card>{Object.entries(fields).map(([label, value]) => <Text selectable key={label}>{label}: {value || 'Not available in this runtime'}</Text>)}</Card></Screen>;
}
