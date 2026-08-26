import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const isExpoGo = Constants.executionEnvironment === 'storeClient';
export const supportsNativePush = Platform.OS !== 'web' && !isExpoGo;

export function isProductionNativeRuntime() {
  return Platform.OS !== 'web' && !__DEV__;
}
