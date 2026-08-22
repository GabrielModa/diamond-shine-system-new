import { AuthProvider } from '@/lib/auth-context';
import { colors } from '@/lib/theme';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import 'react-native-reanimated';

export default function RootLayout() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type === 'operational_notice') router.push('/(tabs)/inbox');
    });
    return () => subscription.remove();
  }, []);
  return <AuthProvider>
    <StatusBar style="dark" />
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.ink, headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="visit/[id]" options={{ title: 'Visit' }} />
        <Stack.Screen name="stock/[siteId]" options={{ title: 'Site materials' }} />
        <Stack.Screen name="camera/[visitId]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      </Stack>
  </AuthProvider>;
}
