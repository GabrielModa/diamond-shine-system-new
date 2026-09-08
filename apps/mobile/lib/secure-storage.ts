import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

function webStorage() {
  return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
}

export async function secureGet(key: string) {
  if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function secureSet(key: string, value: string) {
  if (Platform.OS === 'web') {
    webStorage()?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

export async function secureDelete(key: string) {
  if (Platform.OS === 'web') {
    webStorage()?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function canUseBiometricSecureStorage() {
  return Platform.OS !== 'web' && SecureStore.canUseBiometricAuthentication();
}

export async function biometricSecureSet(key: string, value: string, prompt = 'Confirm your identity') {
  if (Platform.OS === 'web') throw new Error('Biometric sign-in is available only on a phone or tablet.');
  if (!SecureStore.canUseBiometricAuthentication()) throw new Error('Set up fingerprint or Face ID on this device first.');
  await SecureStore.setItemAsync(key, value, {
    requireAuthentication: true,
    authenticationPrompt: prompt,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
}

export async function biometricSecureGet(key: string, prompt = 'Sign in to Diamond Shine') {
  if (Platform.OS === 'web') return null;
  if (!SecureStore.canUseBiometricAuthentication()) return null;
  return SecureStore.getItemAsync(key, {
    requireAuthentication: true,
    authenticationPrompt: prompt,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
}

export async function biometricSecureDelete(key: string) {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(key);
}
