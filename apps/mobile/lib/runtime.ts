import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const isExpoGo = Constants.executionEnvironment === 'storeClient';
export const remotePushEnabled = process.env.EXPO_PUBLIC_REMOTE_PUSH_ENABLED === 'true';
export const supportsNativePush = remotePushEnabled && Platform.OS !== 'web' && !isExpoGo;

export function isProductionNativeRuntime() {
  return Platform.OS !== 'web' && !__DEV__;
}
