import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiFetch } from './api';
import { getDeviceId } from './device';
import { supportsNativePush } from './runtime';
import type { Session } from './types';

let handlerConfigured = false;

export type PushRegistrationStage = 'runtime' | 'permissions' | 'configuration' | 'provider' | 'server';

export type PushRegistrationResult = {
  status: 'registered' | 'unavailable' | 'permission_denied';
  token: string | null;
  stage: PushRegistrationStage;
  message: string;
};

export class PushRegistrationError extends Error {
  constructor(
    public stage: PushRegistrationStage,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = 'PushRegistrationError';
  }
}

function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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

export async function registerForPushNotifications(session: Session): Promise<PushRegistrationResult> {
  if (!supportsNativePush) {
    return {
      status: 'unavailable',
      token: null,
      stage: 'runtime',
      message: 'Remote push requires an installed development or production build.',
    };
  }
  if (!Device.isDevice) {
    return {
      status: 'unavailable',
      token: null,
      stage: 'runtime',
      message: 'Remote push registration requires a physical phone.',
    };
  }

  let Notifications: Awaited<ReturnType<typeof notifications>>;
  try {
    Notifications = await notifications();
  } catch (error) {
    throw new PushRegistrationError('runtime', 'The native notification service could not start.', errorDetail(error));
  }
  if (!Notifications) {
    return {
      status: 'unavailable',
      token: null,
      stage: 'runtime',
      message: 'Remote push is not available in this app runtime.',
    };
  }

  if (Platform.OS === 'android') {
    try {
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
    } catch (error) {
      throw new PushRegistrationError('runtime', 'Android notification channels could not be configured.', errorDetail(error));
    }
  }

  let permission;
  try {
    const current = await Notifications.getPermissionsAsync();
    permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  } catch (error) {
    throw new PushRegistrationError('permissions', 'Notification permission could not be checked.', errorDetail(error));
  }
  if (!permission.granted) {
    return {
      status: 'permission_denied',
      token: null,
      stage: 'permissions',
      message: 'Notifications are disabled. Enable them in the phone settings, then retry.',
    };
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) {
    throw new PushRegistrationError('configuration', 'The EAS project ID is missing from this build.');
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (error) {
    throw new PushRegistrationError('provider', 'Expo could not create a push token for this phone.', errorDetail(error));
  }

  try {
    await apiFetch(session, '/api/devices/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS, deviceId: await getDeviceId() }),
    });
  } catch (error) {
    throw new PushRegistrationError('server', 'The push token could not be saved to the company server.', errorDetail(error));
  }

  return {
    status: 'registered',
    token,
    stage: 'server',
    message: 'This phone is registered for remote notifications.',
  };
}
