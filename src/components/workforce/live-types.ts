export type LiveState = 'on_job' | 'starting_soon' | 'attention' | 'expected_school' | 'available' | 'unavailable'
export type LiveFilter = 'all' | 'on_job' | 'starting_soon' | 'attention' | 'expected_school' | 'available'

export type LiveSite = {
  id: string
  name: string
  city: string
  addressLine1: string
  latitude: number | null
  longitude: number | null
  client: { displayName: string }
}

export type LiveVisit = {
  id: string
  status: string
  scheduledStart: string
  scheduledEnd: string
  site: LiveSite
}

export type LiveEmployee = {
  id: string
  name: string
  email: string
  setupRequired: boolean
  state: LiveState
  attention: boolean
  attentionReason: string | null
  signal: {
    state: 'fresh' | 'stale' | 'missing' | 'not_expected'
    capturedAt: string | null
    ageSeconds: number | null
    classification: string | null
    distanceM: number | null
    accuracyM: number | null
  }
  timer: { id: string; startedAt: string } | null
  currentVisit: LiveVisit | null
  nextVisit: LiveVisit | null
  expectedContext: {
    state: 'home' | 'school' | 'personal_leave' | 'recurring_unavailability' | 'temporary_unavailability'
    school: { label: string; address: string } | null
    temporaryReason: string | null
  }
  mapPoint: {
    kind: 'live_gps' | 'expected_visit_site' | 'expected_school'
    latitude: number
    longitude: number
    label: string
  } | null
  criticalIncident: { id: string; title: string; status: string } | null
}

export type LiveData = {
  generatedAt: string
  timezone: string
  summary: {
    people: number
    visible: number
    onJob: number
    startingSoon: number
    attention: number
    expectedSchool: number
    available: number
    unavailable: number
  }
  employees: LiveEmployee[]
}
