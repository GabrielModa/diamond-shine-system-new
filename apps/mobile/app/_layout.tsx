import { AuthProvider } from '@/lib/auth-context';
import { isExpoGo } from '@/lib/runtime';
import { colors } from '@/lib/theme';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

function openNotification(data?: Record<string, unknown>) {
  if (data?.type === 'operational_notice') router.push('/(tabs)/inbox');
}

export default function RootLayout() {
  useEffect(() => {
    if (isExpoGo) return;
    let disposed = false;
    let removeListener: (() => void) | null = null;

    void import('expo-notifications').then(async (Notifications) => {
      if (disposed) return;
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        openNotification(response.notification.request.content.data as Record<string, unknown> | undefined);
      });
      removeListener = () => subscription.remove();
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!disposed && last) openNotification(last.notification.request.content.data as Record<string, unknown> | undefined);
    }).catch(() => undefined);

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  return <SafeAreaProvider>
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.ink, headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: 'My profile' }} />
        <Stack.Screen name="time-records" options={{ title: 'Location & time' }} />
        <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
        <Stack.Screen name="stock/[siteId]" options={{ title: 'Site materials' }} />
        <Stack.Screen name="camera/[visitId]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      </Stack>
    </AuthProvider>
  </SafeAreaProvider>;
}
