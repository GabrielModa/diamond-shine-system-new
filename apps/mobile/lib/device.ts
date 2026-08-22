import * as SecureStore from 'expo-secure-store';

const DEVICE_KEY = 'diamond-shine-device-v1';
export async function getDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_KEY);
  if (existing) return existing;
  const created = `field-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(DEVICE_KEY, created);
  return created;
}
