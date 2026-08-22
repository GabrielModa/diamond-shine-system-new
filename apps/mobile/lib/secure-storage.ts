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
