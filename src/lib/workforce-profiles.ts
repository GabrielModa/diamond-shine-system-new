export type WorkforceProfile = {
  home: { label: string; address: string; latitude: number; longitude: number }
  study?: { label: string; address: string; latitude: number; longitude: number }
  travelMode: 'driving' | 'transit' | 'cycling'
}

const profiles: Record<string, WorkforceProfile> = {
  'employee@ds.ie': {
    home: { label: 'Home base', address: 'Phibsborough, Dublin 7', latitude: 53.3597, longitude: -6.2735 },
    study: { label: 'Study location', address: 'TU Dublin Grangegorman, Dublin 7', latitude: 53.3475, longitude: -6.2771 },
    travelMode: 'transit',
  },
  'maria@ds.ie': {
    home: { label: 'Home base', address: 'Rathmines, Dublin 6', latitude: 53.3242, longitude: -6.2656 },
    study: { label: 'Study location', address: 'Dublin Business School, Aungier Street', latitude: 53.3408, longitude: -6.2641 },
    travelMode: 'cycling',
  },
  'john@ds.ie': {
    home: { label: 'Home base', address: 'Drumcondra, Dublin 9', latitude: 53.3668, longitude: -6.2586 },
    study: { label: 'Study location', address: 'DCU Glasnevin, Dublin 9', latitude: 53.3853, longitude: -6.2560 },
    travelMode: 'transit',
  },
  'emma@ds.ie': {
    home: { label: 'Home base', address: 'Clontarf, Dublin 3', latitude: 53.3639, longitude: -6.1938 },
    study: { label: 'Study location', address: 'Trinity College Dublin, Dublin 2', latitude: 53.3438, longitude: -6.2546 },
    travelMode: 'cycling',
  },
  'michael@ds.ie': {
    home: { label: 'Home base', address: 'Stoneybatter, Dublin 7', latitude: 53.3488, longitude: -6.2926 },
    study: { label: 'Study location', address: 'National College of Ireland, IFSC', latitude: 53.3490, longitude: -6.2456 },
    travelMode: 'driving',
  },
  'gabriel.moda@ds.ie': {
    home: { label: 'Home base', address: 'Dundrum, Dublin 14', latitude: 53.2897, longitude: -6.2437 },
    study: { label: 'Study location', address: 'UCD Belfield, Dublin 4', latitude: 53.3078, longitude: -6.2200 },
    travelMode: 'driving',
  },
}

const fallback: WorkforceProfile = {
  home: { label: 'Home base', address: 'Dublin city centre', latitude: 53.3498, longitude: -6.2603 },
  study: { label: 'Study location', address: 'Dublin learning hub', latitude: 53.3426, longitude: -6.2675 },
  travelMode: 'transit',
}

/** Demo-only planning profiles. In production these map to consented workforce profile records. */
export function workforceProfileFor(email: string): WorkforceProfile {
  return profiles[email.toLowerCase()] ?? fallback
}

export function haversineKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180
  const earthKm = 6371
  const dLat = radians(to.latitude - from.latitude)
  const dLng = radians(to.longitude - from.longitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function travelEstimate(distanceKm: number, mode: WorkforceProfile['travelMode']) {
  const speeds = { driving: 23, transit: 17, cycling: 14 }
  const buffer = { driving: 5, transit: 8, cycling: 3 }
  return Math.max(4, Math.round(distanceKm / speeds[mode] * 60 + buffer[mode]))
}
