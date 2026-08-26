import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiFetch } from './api';
import { getDeviceId } from './device';
import { supportsNativePush } from './runtime';
import type { Session } from './types';

let handlerConfigured = false;

async function notifications() {
  if (!supportsNativePush) return null;
  const Notifications = await import('expo-notifications');
  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    handlerConfigured = true;
  }
  return Notifications;
}

export async function registerForPushNotifications(session: Session) {
  if (!supportsNativePush || !Device.isDevice) return null;
  const Notifications = await notifications();
  if (!Notifications) return null;

  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync('operations', {
        name: 'Operations',
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
      Notifications.setNotificationChannelAsync('urgent-operations', {
        name: 'Urgent operations',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 150, 250],
      }),
    ]);
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) return null;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await apiFetch(session, '/api/devices/push-token', {
    method: 'POST',
    body: JSON.stringify({ token, platform: Platform.OS, deviceId: await getDeviceId() }),
  });
  return token;
}
