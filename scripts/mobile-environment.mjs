import os from 'node:os'
import { isIPv4 } from 'node:net'
import { fileURLToPath } from 'node:url'
export const root = fileURLToPath(new URL('../', import.meta.url))
export const mobileRoot = fileURLToPath(new URL('../apps/mobile/', import.meta.url))
export const productionApi = 'https://diamond-shine-system-new.vercel.app'
export function selectLanAddress(interfaces = os.networkInterfaces(), override) {
  const entries = Object.entries(interfaces).flatMap(([name, addresses]) => (addresses ?? []).filter(a => !a.internal && a.family === 'IPv4' && !a.address.startsWith('169.254.')).map(a => ({ name, address: a.address })))
  if (override) {
    if (!isIPv4(override) || !entries.some(a => a.address === override)) throw new Error('DIAMOND_LAN_IP must be an IPv4 address assigned to this PC.')
    return override
  }
  const candidates = entries.filter(a => !/virtual|vethernet|docker|wsl|vpn|tailscale|loopback/i.test(a.name))
  candidates.sort((a, b) => Number(/wi-?fi|wireless/i.test(b.name)) - Number(/wi-?fi|wireless/i.test(a.name)) || a.name.localeCompare(b.name))
  if (!candidates.length) throw new Error('No LAN IPv4 found. Connect Wi-Fi or set DIAMOND_LAN_IP to an assigned adapter address.')
  return candidates[0].address
}
export function mobileEnvironment(env, address, production = false) {
  const allowed = /^(EXPO_PUBLIC_|PATH$|PATHEXT$|SYSTEMROOT$|WINDIR$|COMSPEC$|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|TEMP$|TMP$|TERM|COLORTERM$|CI$|ANDROID_HOME$|ANDROID_SDK_ROOT$|JAVA_HOME$)/i
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => allowed.test(key))), EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API_URL: production ? productionApi : `http://${address}:3000`, REACT_NATIVE_PACKAGER_HOSTNAME: address }
}
