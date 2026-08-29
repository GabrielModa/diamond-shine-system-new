'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import WeeklyWindowEditor, { type WeeklyRule } from './WeeklyWindowEditor'
import GooglePlaceAutocomplete, { type PlaceSelection } from './GooglePlaceAutocomplete'
import DateTimeField12h from '../ui/DateTimeField12h'
import { formatMinuteOfDay, formatOperationalDateTime } from '../../lib/operational-time'
import styles from './EmployeeSelfProfileEditor.module.css'

type Profile = {
  phone: string | null
  home: { label: string; address: string; latitude: number | null; longitude: number | null }
  travelMode: 'driving' | 'transit' | 'cycling'
  emergencyContact: { name: string; phone: string } | null
  school: { name: string; address: string; latitude: number | null; longitude: number | null } | null
  studySchedule: WeeklyRule[]
  recurringUnavailability: WeeklyRule[]
}

type Data = {
  user: { id: string; name: string | null; email: string }
  profile: Profile | null
  setupRequired: boolean
  managerSetupRequired: boolean
}

type AvailabilityEntry = { id: string; startsAt: string; endsAt: string; reason: string | null }
type CreatedAvailability = AvailabilityEntry & {
  noticeLevel: 'planned' | 'late' | 'urgent'
  affectedAssignments: number
  managementNotified: boolean
}

type Message = { type: 'success' | 'error'; text: string } | null

type EditorMode = 'profile' | 'onboarding'

const localInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

const validPhone = (value: string) => {
  let compact = value.trim().replace(/[\s().-]/g, '')
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`
  if (/^0\d{8,10}$/.test(compact)) compact = `+353${compact.slice(1)}`
  return /^\+[1-9]\d{7,14}$/.test(compact)
}

function weeklyError(rules: WeeklyRule[], label: string) {
  for (const rule of rules) {
    if (rule.endsMinute <= rule.startsMinute) return `${label}: Until must be later than From.`
  }
  for (let day = 1; day <= 7; day += 1) {
    const items = rules.filter((rule) => rule.dayOfWeek === day).sort((a, b) => a.startsMinute - b.startsMinute)
    for (let index = 1; index < items.length; index += 1) {
      if (items[index].startsMinute < items[index - 1].endsMinute) return `${label}: overlapping times are not allowed on the same day.`
    }
  }
  return null
}

function leadLabel(startsAt: string) {
  const hours = (new Date(startsAt).getTime() - Date.now()) / 3_600_000
  if (hours < 24) return 'Urgent'
  if (hours < 24 * 7) return 'Late notice'
  return 'Planned'
}

function travelLabel(mode: Profile['travelMode']) {
  if (mode === 'driving') return 'Driving'
  if (mode === 'cycling') return 'Cycling'
  return 'Public transport'
}

function groupedRules(rules: WeeklyRule[]) {
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const grouped = new Map<string, number[]>()
  for (const rule of rules) {
    const key = `${rule.startsMinute}-${rule.endsMinute}-${rule.reason ?? ''}`
    const days = grouped.get(key) ?? []
    days.push(rule.dayOfWeek)
    grouped.set(key, days)
  }
  return Array.from(grouped.entries()).map(([key, days]) => {
    const [start, end, reason] = key.split('-')
    return {
      key,
      days: days.sort((a, b) => a - b).map((day) => names[day]).join(', '),
      time: `${formatMinuteOfDay(Number(start))}–${formatMinuteOfDay(Number(end))}`,
      reason: reason || null,
    }
  })
}

export default function EmployeeSelfProfileEditor({ mode = 'profile', setupToken }: { mode?: EditorMode; setupToken?: string }) {
  const onboarding = mode === 'onboarding'
  const [data, setData] = useState<Data | null>(null)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [travelMode, setTravelMode] = useState<Profile['travelMode']>('transit')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [schoolAddress, setSchoolAddress] = useState('')
  const [schoolQuery, setSchoolQuery] = useState('')
  const [homePlace, setHomePlace] = useState<PlaceSelection | null>(null)
  const [schoolPlace, setSchoolPlace] = useState<PlaceSelection | null>(null)
  const [schoolChoice, setSchoolChoice] = useState<'yes' | 'no' | null>(null)
  const [studyRules, setStudyRules] = useState<WeeklyRule[]>([])
  const [recurringRules, setRecurringRules] = useState<WeeklyRule[]>([])
  const [entries, setEntries] = useState<AvailabilityEntry[]>([])
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null)
  const [message, setMessage] = useState<Message>(null)
  const [step, setStep] = useState(0)
  const [editing, setEditing] = useState<{ contact: boolean; home: boolean; school: boolean; week: boolean }>({ contact: false, home: false, school: false, week: false })
  const [showTemporaryForm, setShowTemporaryForm] = useState(false)

  const applyProfile = useCallback((next: Data) => {
    setData(next)
    setPhone(next.profile?.phone ?? '')
    setAddress(next.profile?.home.address ?? '')
    setTravelMode(next.profile?.travelMode ?? 'transit')
    setEmergencyName(next.profile?.emergencyContact?.name ?? '')
    setEmergencyPhone(next.profile?.emergencyContact?.phone ?? '')
    setSchoolName(next.profile?.school?.name ?? '')
    setSchoolAddress(next.profile?.school?.address ?? '')
    setSchoolQuery(next.profile?.school?.name ?? '')
    setHomePlace(next.profile?.home.latitude != null && next.profile.home.longitude != null ? {
      placeId: '',
      displayName: null,
      formattedAddress: next.profile.home.address,
      latitude: next.profile.home.latitude,
      longitude: next.profile.home.longitude,
      types: [],
    } : null)
    setSchoolPlace(next.profile?.school?.latitude != null && next.profile.school.longitude != null ? {
      placeId: '',
      displayName: next.profile.school.name,
      formattedAddress: next.profile.school.address,
      latitude: next.profile.school.latitude,
      longitude: next.profile.school.longitude,
      types: [],
    } : null)
    setSchoolChoice(next.profile?.school ? 'yes' : null)
    setStudyRules(next.profile?.studySchedule ?? [])
    setRecurringRules(next.profile?.recurringUnavailability ?? [])
  }, [])

  const loadProfile = useCallback(async () => {
    const url = onboarding
      ? `/api/auth/invite-setup?token=${encodeURIComponent(setupToken ?? '')}`
      : '/api/workforce/profile'
    const response = await fetch(url, { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load profile.')
    if (onboarding && body.data?.stage === 'password') {
      window.location.replace(`/set-password?token=${encodeURIComponent(setupToken ?? '')}`)
      return
    }
    if (onboarding && body.data?.stage === 'complete') {
      window.location.replace('/login')
      return
    }
    applyProfile(body.data as Data)
  }, [applyProfile, onboarding, setupToken])

  const loadAvailability = useCallback(async () => {
    if (onboarding) return
    const response = await fetch('/api/availability', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load availability.')
    setEntries(body.data as AvailabilityEntry[])
  }, [onboarding])

  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3_600_000)
    start.setMinutes(0, 0, 0)
    const end = new Date(start.getTime() + 8 * 3_600_000)
    setStartsAt(localInputValue(start))
    setEndsAt(localInputValue(end))
    void Promise.all([loadProfile(), loadAvailability()]).catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [loadAvailability, loadProfile])

  const activeEntries = useMemo(() => entries.filter((entry) => new Date(entry.endsAt).getTime() > Date.now()), [entries])

  function openEditor(section: 'contact' | 'home' | 'school' | 'week') {
    setEditing({
      contact: section === 'contact',
      home: section === 'home',
      school: section === 'school',
      week: section === 'week',
    })
    setMessage(null)
  }

  function resetSection(section: 'contact' | 'home' | 'school' | 'week') {
    const profile = data?.profile
    if (section === 'contact') {
      setPhone(profile?.phone ?? '')
      setEmergencyName(profile?.emergencyContact?.name ?? '')
      setEmergencyPhone(profile?.emergencyContact?.phone ?? '')
    } else if (section === 'home') {
      setAddress(profile?.home.address ?? '')
      setTravelMode(profile?.travelMode ?? 'transit')
      setHomePlace(profile?.home.latitude != null && profile.home.longitude != null ? {
        placeId: '', displayName: null, formattedAddress: profile.home.address,
        latitude: profile.home.latitude, longitude: profile.home.longitude, types: [],
      } : null)
    } else if (section === 'school') {
      setSchoolChoice(profile?.school ? 'yes' : null)
      setSchoolName(profile?.school?.name ?? '')
      setSchoolAddress(profile?.school?.address ?? '')
      setSchoolQuery(profile?.school?.name ?? '')
      setSchoolPlace(profile?.school?.latitude != null && profile.school.longitude != null ? {
        placeId: '', displayName: profile.school.name, formattedAddress: profile.school.address,
        latitude: profile.school.latitude, longitude: profile.school.longitude, types: [],
      } : null)
      setStudyRules(profile?.studySchedule ?? [])
    } else {
      setRecurringRules(profile?.recurringUnavailability ?? [])
    }
  }

  function validateContact() {
    if (!phone.trim() || !validPhone(phone)) return 'Enter a valid phone number, for example +353871234567.'
    if (Boolean(emergencyName.trim()) !== Boolean(emergencyPhone.trim())) return 'Enter both emergency contact name and phone, or leave both blank.'
    if (emergencyPhone.trim() && !validPhone(emergencyPhone)) return 'Enter a valid emergency contact phone number.'
    return null
  }

  function validateHome() {
    if (!address.trim() || !homePlace) return 'Choose your home / operational starting address from the Google Maps suggestions.'
    return null
  }

  function validateSchool() {
    if (schoolChoice === null) return 'Choose whether you currently attend school or college.'
    if (schoolChoice === 'no') return null
    if (!schoolPlace) return 'Choose your school / college from the Google Maps suggestions.'
    return weeklyError(studyRules, 'Study hours')
  }

  function validateWeek() {
    return weeklyError(recurringRules, 'Weekly unavailability')
  }

  async function patchSection(section: 'contact' | 'home' | 'school' | 'normal_week', payload: Record<string, unknown>, successText: string) {
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/workforce/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, ...payload }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save this section.')
      applyProfile(body.data as Data)
      setMessage({ type: 'success', text: successText })
      return true
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save this section.' })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveContact() {
    const error = validateContact()
    if (error) { setMessage({ type: 'error', text: error }); return }
    const saved = await patchSection('contact', {
      phone: phone.trim(),
      emergencyContact: emergencyName.trim() && emergencyPhone.trim() ? { name: emergencyName.trim(), phone: emergencyPhone.trim() } : null,
    }, 'Contact details saved.')
    if (saved) setEditing((current) => ({ ...current, contact: false }))
  }

  async function saveHome() {
    const error = validateHome()
    if (error) { setMessage({ type: 'error', text: error }); return }
    const saved = await patchSection('home', { home: { address: homePlace!.formattedAddress }, travelMode }, 'Home address verified with Google Maps and saved for routing.')
    if (saved) setEditing((current) => ({ ...current, home: false }))
  }

  async function saveSchool() {
    const error = validateSchool()
    if (error) { setMessage({ type: 'error', text: error }); return }
    const hasSchool = schoolChoice === 'yes' && Boolean(schoolPlace)
    const saved = await patchSection('school', {
      school: hasSchool ? { name: schoolPlace!.displayName ?? schoolName.trim(), address: schoolPlace!.formattedAddress } : null,
      studySchedule: hasSchool ? studyRules : [],
    }, hasSchool ? 'School location verified with Google Maps and study hours saved.' : 'School details cleared.')
    if (saved) setEditing((current) => ({ ...current, school: false }))
  }

  async function saveWeek() {
    const error = validateWeek()
    if (error) { setMessage({ type: 'error', text: error }); return }
    const saved = await patchSection('normal_week', { recurringUnavailability: recurringRules }, 'Your normal weekly availability was saved. Operations can now schedule around these restrictions.')
    if (saved) setEditing((current) => ({ ...current, week: false }))
  }

  function validateOnboardingStep() {
    const error = step === 0 ? validateContact() : step === 1 ? validateHome() : step === 2 ? validateSchool() : validateWeek()
    if (error) setMessage({ type: 'error', text: error })
    return !error
  }

  async function finishOnboarding() {
    if (!validateOnboardingStep()) return
    const contactError = validateContact()
    const homeError = validateHome()
    const schoolError = validateSchool()
    const weekError = validateWeek()
    const firstError = contactError || homeError || schoolError || weekError
    if (firstError) { setMessage({ type: 'error', text: firstError }); return }

    setBusy(true)
    setMessage(null)
    try {
      if (!setupToken || !homePlace?.placeId) throw new Error('This secure setup link is incomplete. Open the invitation again.')
      const response = await fetch('/api/auth/invite-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: setupToken,
          phone: phone.trim(),
          homePlaceId: homePlace.placeId,
          travelMode,
          emergencyContact: emergencyName.trim() && emergencyPhone.trim() ? { name: emergencyName.trim(), phone: emergencyPhone.trim() } : null,
          schoolPlaceId: schoolChoice === 'yes' ? schoolPlace?.placeId || null : null,
          studySchedule: schoolChoice === 'yes' && schoolPlace ? studyRules : [],
          recurringUnavailability: recurringRules,
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not complete your profile setup.')
      window.location.assign(body.data?.nextUrl ?? '/profile')
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not complete your profile setup.' })
    } finally {
      setBusy(false)
    }
  }

  async function saveTemporaryUnavailability() {
    if (!startsAt || !endsAt) {
      setMessage({ type: 'error', text: 'Choose a start and end time.' })
      return
    }
    const start = new Date(startsAt)
    const end = new Date(endsAt)
    if (!(end > start)) {
      setMessage({ type: 'error', text: 'Temporary unavailability must end after it starts.' })
      return
    }

    setAvailabilityBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString(), reason: reason.trim() || null }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save temporary unavailability.')
      const created = body.data as CreatedAvailability
      const notice = created.noticeLevel === 'urgent' ? 'Urgent change saved.' : created.noticeLevel === 'late' ? 'Late-notice change saved.' : 'Planned change saved.'
      const impact = created.affectedAssignments ? ` ${created.affectedAssignments} assignment(s) need staffing review.` : ''
      const notified = created.managementNotified ? ' Operations was notified.' : ''
      setMessage({ type: 'success', text: `${notice}${impact}${notified} No client visit was cancelled automatically.` })
      setReason('')
      setShowTemporaryForm(false)
      await loadAvailability()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save temporary unavailability.' })
    } finally {
      setAvailabilityBusy(false)
    }
  }

  async function removeTemporary(entry: AvailabilityEntry) {
    if (!window.confirm('Remove this temporary unavailability?')) return
    setBusyEntryId(entry.id)
    setMessage(null)
    try {
      const response = await fetch(`/api/availability/${entry.id}`, { method: 'DELETE' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not remove unavailability.')
      setMessage({ type: 'success', text: 'Temporary unavailability removed. Published visits were not changed automatically.' })
      await loadAvailability()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not remove unavailability.' })
    } finally {
      setBusyEntryId(null)
    }
  }

  if (!data) return <main className="page-shell"><section className="card empty-state">Loading profile…</section></main>

  if (onboarding) {
    const steps = ['Contact', 'Home & travel', 'School & study', 'Normal week']
    return <main className="page-shell">
      <header className="page-header">
        <div><span className="eyebrow">Account setup</span><h1>Finish your work profile</h1><p className="muted">Your password is saved, but your account is not active yet. Finish these details and Diamond Shine will create your access with real routing and availability data.</p></div>
      </header>
      {message ? <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}
      <section className="card">
        <div className="row tight" style={{ flexWrap: 'wrap' }}>
          <span style={{ padding: '8px 12px', borderRadius: 999, background: '#ecfdf5', color: '#047857', fontWeight: 700 }}>1. Password ✓</span>
          {steps.map((label, index) => <span key={label} style={{ padding: '8px 12px', borderRadius: 999, background: index === step ? '#ede9fe' : index < step ? '#ecfdf5' : '#f3f4f6', color: index === step ? '#5b21b6' : index < step ? '#047857' : '#4b5563', fontWeight: 700 }}>{index + 2}. {label}</span>)}
        </div>
      </section>

      {step === 0 ? <section className="card">
        <div className="section-heading"><div><h2>Identity & contact</h2><p className="muted">Your company set your name and work email. You add the phone details used for operational contact.</p></div></div>
        <div className="admin-form-grid">
          <label><span>Name</span><input value={data.user.name ?? ''} disabled /></label>
          <label><span>Work email</span><input value={data.user.email} disabled /></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+353 87 123 4567" autoComplete="tel" /></label>
          <label><span>Emergency contact name (optional)</span><input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} /></label>
          <label><span>Emergency contact phone (optional)</span><input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} autoComplete="tel" /></label>
        </div>
      </section> : null}

      {step === 1 ? <section className="card">
        <div className="section-heading"><div><h2>Home & travel</h2><p className="muted">Start typing your home address or Eircode, then choose the correct Google Maps result.</p></div></div>
        <div className={`admin-form-grid two-columns ${styles.profileFormGrid}`}>
          <GooglePlaceAutocomplete
            kind="home"
            label="Home address"
            value={address}
            selected={homePlace}
            setupToken={setupToken}
            placeholder="Start typing your address or Eircode…"
            helpText="Choose the exact result from Google Maps. A street name by itself is not enough for routing."
            onValueChange={(value) => { setAddress(value); setHomePlace(null) }}
            onSelect={(place) => { setHomePlace(place); setAddress(place.formattedAddress); setMessage(null) }}
          />
          <label><span>How do you usually travel to work?</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value as Profile['travelMode'])}><option value="driving">Driving</option><option value="transit">Public transport</option><option value="cycling">Cycling</option></select></label>
        </div>
      </section> : null}

      {step === 2 ? <section className="card">
        <div className="section-heading"><div><h2>School & study</h2><p className="muted">Tell us only if school or college is part of your normal week. Nothing is added automatically.</p></div></div>

        <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 14, background: '#f7f8fc', border: '1px solid #e5e7eb' }}>
          <div><strong>Do you currently attend school or college?</strong><p className="muted" style={{ margin: '4px 0 0' }}>We use this only to avoid scheduling you during recurring study hours and to know your route origin after class.</p></div>
          <div className="segmented-control" style={{ justifySelf: 'start' }}>
            <button type="button" className={schoolChoice === 'no' ? 'selected' : ''} onClick={() => { setSchoolChoice('no'); setSchoolQuery(''); setSchoolPlace(null); setSchoolName(''); setSchoolAddress(''); setStudyRules([]); setMessage(null) }}>No</button>
            <button type="button" className={schoolChoice === 'yes' ? 'selected' : ''} onClick={() => { setSchoolChoice('yes'); setMessage(null) }}>Yes</button>
          </div>
        </div>

        {schoolChoice === 'yes' ? <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
          <GooglePlaceAutocomplete
            kind="school"
            label="School or college"
            value={schoolQuery}
            selected={schoolPlace}
            setupToken={setupToken}
            placeholder="Start typing the school or college name…"
            helpText="Choose the real Google Maps result. We keep its mapped location for routing."
            onValueChange={(value) => {
              setSchoolQuery(value)
              setSchoolPlace(null)
              setSchoolName('')
              setSchoolAddress('')
              setStudyRules([])
            }}
            onSelect={(place) => {
              setSchoolPlace(place)
              setSchoolName(place.displayName ?? 'School')
              setSchoolAddress(place.formattedAddress)
              setSchoolQuery(place.displayName ?? place.formattedAddress)
              setMessage(null)
            }}
          />

          {schoolPlace ? <div style={{ display: 'grid', gap: 8 }}>
            <div><strong>When are you unavailable because of school?</strong><p className="muted" style={{ margin: '4px 0 0' }}>Optional. Add only the recurring hours that genuinely block work. You can add more than one block.</p></div>
            <WeeklyWindowEditor value={studyRules} onChange={setStudyRules} emptyText="No study hours added yet." addLabel="Add study hours" defaultStart={540} defaultEnd={750} />
          </div> : null}
        </div> : null}

        {schoolChoice === 'no' ? <div className="toast success" style={{ marginTop: 14 }}>No school schedule will be added. You can change this later in My profile.</div> : null}
      </section> : null}

      {step === 3 ? <section className="card">
        <div className="section-heading"><div><h2>My normal week</h2><p className="muted">Add any other recurring times you cannot work, such as another job or a fixed family commitment. Choose several days at once.</p></div></div>
        <WeeklyWindowEditor value={recurringRules} onChange={setRecurringRules} reasonEnabled emptyText="No other recurring restrictions. You can add them later from My profile." addLabel="Add unavailable time" defaultStart={1080} defaultEnd={1320} />
      </section> : null}

      <section className="card"><div className="row tight" style={{ justifyContent: 'space-between' }}>
        <button className="btn-secondary" type="button" disabled={step === 0 || busy} onClick={() => { setMessage(null); setStep((current) => Math.max(0, current - 1)) }}>Back</button>
        {step < 3 ? <button className="btn-primary" type="button" disabled={busy || (step === 1 && !homePlace) || (step === 2 && (schoolChoice === null || (schoolChoice === 'yes' && !schoolPlace)))} onClick={() => { if (validateOnboardingStep()) { setMessage(null); setStep((current) => Math.min(3, current + 1)) } }}>Continue</button> : <button className="btn-primary" type="button" disabled={busy} onClick={() => void finishOnboarding()}>{busy ? 'Creating account…' : 'Create account & finish setup'}</button>}
      </div></section>
    </main>
  }

  if (!data.profile) {
    return <main className="page-shell">
      <header className="page-header"><div><span className="eyebrow">My operational profile</span><h1>My profile</h1><p className="muted">Complete your setup before Diamond Shine can use your real routing and availability information.</p></div></header>
      {message ? <div className={`toast ${message.type}`}>{message.text}</div> : null}
      <section className="card"><h2>Profile setup is not complete</h2><p className="muted">This account predates the guided invitation flow. Ask an administrator to resend a secure setup link before operational scheduling is enabled.</p></section>
    </main>
  }

  const studyGroups = groupedRules(data.profile.studySchedule)
  const recurringGroups = groupedRules(data.profile.recurringUnavailability)

  return <main className={`page-shell ${styles.shell}`}>
    <header className={`page-header ${styles.hero}`}>
      <div>
        <span className="eyebrow">My operational profile</span>
        <h1>My profile</h1>
        <p className="muted">Keep the details that affect how Diamond Shine contacts, routes and schedules you up to date. Edit only the section that changed.</p>
      </div>
    </header>

    {message ? <div className={`toast ${message.type} ${styles.message}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}

    <section className={`card ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Identity & contact</h2>
          <p className="muted">Your name and work email come from the company. Keep your phone and emergency contact current.</p>
        </div>
        {!editing.contact ? <button className={`btn-secondary ${styles.editButton}`} type="button" onClick={() => openEditor('contact')}>Edit contact</button> : null}
      </div>

      {editing.contact ? <div className={styles.editPanel}>
        <div className={`admin-form-grid ${styles.contactEditGrid}`}>
          <label><span>Name</span><input value={data.user.name ?? ''} disabled /></label>
          <label><span>Work email</span><input value={data.user.email} disabled /></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="+353 87 123 4567" /></label>
          <label><span>Emergency contact name (optional)</span><input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} /></label>
          <label><span>Emergency contact phone (optional)</span><input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} autoComplete="tel" placeholder="+353 87 123 4567" /></label>
        </div>
        <div className={styles.actions}>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => { resetSection('contact'); setEditing((current) => ({ ...current, contact: false })) }}>Cancel</button>
          <button className="btn-primary" type="button" disabled={busy} onClick={() => void saveContact()}>{busy ? 'Saving…' : 'Save contact'}</button>
        </div>
      </div> : <dl className={`${styles.infoGrid} ${styles.infoGridFour}`}>
        <div className={styles.infoItem}><dt>Name</dt><dd>{data.user.name ?? 'Not provided'}</dd><small>Company managed</small></div>
        <div className={styles.infoItem}><dt>Work email</dt><dd>{data.user.email}</dd><small>Company managed</small></div>
        <div className={styles.infoItem}><dt>Phone</dt><dd>{data.profile.phone ?? 'Not provided'}</dd></div>
        <div className={styles.infoItem}><dt>Emergency contact</dt><dd>{data.profile.emergencyContact?.name ?? 'Not provided'}</dd>{data.profile.emergencyContact ? <small>{data.profile.emergencyContact.phone}</small> : null}</div>
      </dl>}
    </section>

    <section className={`card ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Home & travel</h2>
          <p className="muted">Your usual starting point for work and the travel mode used for routing.</p>
        </div>
        {!editing.home ? <button className={`btn-secondary ${styles.editButton}`} type="button" onClick={() => openEditor('home')}>Edit home & travel</button> : null}
      </div>

      {editing.home ? <div className={styles.editPanel}>
        <div className={`admin-form-grid two-columns ${styles.profileFormGrid}`}>
          <GooglePlaceAutocomplete
            kind="home"
            label="Home address"
            value={address}
            selected={homePlace}
            placeholder="Start typing your address or Eircode…"
            onValueChange={(value) => { setAddress(value); setHomePlace(null) }}
            onSelect={(place) => { setHomePlace(place); setAddress(place.formattedAddress); setMessage(null) }}
          />
          <label><span>How do you usually travel to work?</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value as Profile['travelMode'])}><option value="driving">Driving</option><option value="transit">Public transport</option><option value="cycling">Cycling</option></select></label>
        </div>
        <div className={styles.actions}>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => { resetSection('home'); setEditing((current) => ({ ...current, home: false })) }}>Cancel</button>
          <button className="btn-primary" type="button" disabled={busy || !homePlace} onClick={() => void saveHome()}>{busy ? 'Saving…' : 'Save home & travel'}</button>
        </div>
      </div> : <dl className={styles.infoGrid}>
        <div className={`${styles.infoItem} ${styles.infoWide}`}>
          <dt>Home address</dt>
          <dd>{data.profile.home.address}</dd>
          <small className={data.profile.home.latitude != null ? styles.verified : styles.warning}>{data.profile.home.latitude != null ? '✓ Verified with Google Maps' : 'Needs verification'}</small>
        </div>
        <div className={styles.infoItem}><dt>Usual travel mode</dt><dd>{travelLabel(data.profile.travelMode)}</dd></div>
      </dl>}
    </section>

    <section className={`card ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>School & study</h2>
          <p className="muted">Optional. School location can become a route origin, while recurring study hours block scheduling.</p>
        </div>
        {!editing.school ? <button className={`btn-secondary ${styles.editButton}`} type="button" onClick={() => { setSchoolChoice(data.profile?.school ? 'yes' : null); openEditor('school') }}>Edit school & study</button> : null}
      </div>

      {editing.school ? <div className={styles.editPanel}>
        <div className={styles.choicePanel}>
          <div><strong>Do you currently attend school or college?</strong><p className="muted">Choose Yes only if this is part of your current normal week.</p></div>
          <div className="segmented-control">
            <button type="button" className={schoolChoice === 'no' ? 'selected' : ''} onClick={() => {
              if (data.profile?.school && !window.confirm('Remove the saved school and all recurring study hours when you save?')) return
              setSchoolChoice('no'); setSchoolQuery(''); setSchoolPlace(null); setSchoolName(''); setSchoolAddress(''); setStudyRules([]); setMessage(null)
            }}>No</button>
            <button type="button" className={schoolChoice === 'yes' ? 'selected' : ''} onClick={() => { setSchoolChoice('yes'); setMessage(null) }}>Yes</button>
          </div>
        </div>

        {schoolChoice === 'yes' ? <div className={styles.schoolEditor}>
          <GooglePlaceAutocomplete
            kind="school"
            label="School or college"
            value={schoolQuery}
            selected={schoolPlace}
            placeholder="Start typing the school or college name…"
            onValueChange={(value) => { setSchoolQuery(value); setSchoolPlace(null); setSchoolName(''); setSchoolAddress(''); setStudyRules([]) }}
            onSelect={(place) => {
              setSchoolPlace(place)
              setSchoolName(place.displayName ?? 'School')
              setSchoolAddress(place.formattedAddress)
              setSchoolQuery(place.displayName ?? place.formattedAddress)
              setMessage(null)
            }}
          />
          {schoolPlace ? <div className={styles.ruleEditorBlock}><div><strong>Recurring study hours</strong><p className="muted">Add only the times when school genuinely makes you unavailable for work.</p></div><WeeklyWindowEditor value={studyRules} onChange={setStudyRules} emptyText="No study hours added yet." addLabel="Add study hours" defaultStart={540} defaultEnd={750} /></div> : null}
        </div> : null}

        {schoolChoice === 'no' ? <div className={styles.inlineNote}>No school or study hours will be saved.</div> : null}
        <div className={styles.actions}>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => { resetSection('school'); setEditing((current) => ({ ...current, school: false })) }}>Cancel</button>
          <button className="btn-primary" type="button" disabled={busy || schoolChoice === null || (schoolChoice === 'yes' && !schoolPlace)} onClick={() => void saveSchool()}>{busy ? 'Saving…' : 'Save school & study'}</button>
        </div>
      </div> : data.profile.school ? <>
        <dl className={styles.infoGrid}>
          <div className={styles.infoItem}><dt>School or college</dt><dd>{data.profile.school.name}</dd></div>
          <div className={styles.infoItem}><dt>Verified address</dt><dd>{data.profile.school.address}</dd><small className={data.profile.school.latitude != null ? styles.verified : styles.warning}>{data.profile.school.latitude != null ? '✓ Verified with Google Maps' : 'Needs verification'}</small></div>
        </dl>
        <div className={styles.scheduleBlock}>
          <span className={styles.blockLabel}>Study hours</span>
          {studyGroups.length ? <div className={styles.ruleList}>{studyGroups.map((group) => <div className={styles.ruleRow} key={group.key}><strong>{group.days}</strong><span>{group.time}</span>{group.reason ? <small>{group.reason}</small> : null}</div>)}</div> : <div className={styles.emptyLine}>No recurring study hours.</div>}
        </div>
      </> : <div className={styles.emptyState}><strong>No school added</strong><span>If school becomes part of your normal week, add it here and choose the hours that block work.</span></div>}
    </section>

    <section className={`card ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>My normal week</h2>
          <p className="muted">Recurring times you cannot work for reasons other than school, such as another job or a fixed family commitment.</p>
        </div>
        {!editing.week ? <button className={`btn-secondary ${styles.editButton}`} type="button" onClick={() => openEditor('week')}>Edit normal week</button> : null}
      </div>

      {editing.week ? <div className={styles.editPanel}>
        <WeeklyWindowEditor value={recurringRules} onChange={setRecurringRules} reasonEnabled emptyText="No recurring weekly restrictions." addLabel="Add unavailable time" defaultStart={1080} defaultEnd={1320} />
        <div className={styles.actions}>
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => { resetSection('week'); setEditing((current) => ({ ...current, week: false })) }}>Cancel</button>
          <button className="btn-primary" type="button" disabled={busy} onClick={() => void saveWeek()}>{busy ? 'Saving…' : 'Save normal week'}</button>
        </div>
      </div> : recurringGroups.length ? <div className={styles.ruleList}>{recurringGroups.map((group) => <div className={styles.ruleRow} key={group.key}><strong>{group.days}</strong><span>{group.time}</span>{group.reason ? <small>{group.reason}</small> : null}</div>)}</div> : <div className={styles.emptyState}><strong>No recurring restrictions</strong><span>You are not currently blocking any regular weekly time outside school.</span></div>}

      <div className={styles.policyNote}>Changes are audited and operations is notified when staffing may be affected. Published client visits are never silently cancelled.</div>
    </section>

    <section className={`card ${styles.sectionCard}`}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Temporary changes</h2>
          <p className="muted">Use this only for a one-off appointment, trip or unexpected day off. It does not change your normal week.</p>
        </div>
        {!showTemporaryForm ? <button className={`btn-primary ${styles.editButton}`} type="button" onClick={() => { setShowTemporaryForm(true); setMessage(null) }}>+ Add temporary change</button> : null}
      </div>

      {showTemporaryForm ? <div className={styles.editPanel}>
        <div className={styles.tempForm}>
          <div className={styles.tempDate}><DateTimeField12h label="Unavailable from" value={startsAt} onChange={setStartsAt} /></div>
          <div className={styles.tempDate}><DateTimeField12h label="Until" value={endsAt} onChange={setEndsAt} /></div>
          <label className={styles.tempReason}><span>Reason (optional)</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Appointment, travel, family commitment…" /></label>
          <button className={`btn-primary ${styles.tempAction}`} type="button" disabled={availabilityBusy} onClick={() => void saveTemporaryUnavailability()}>{availabilityBusy ? 'Saving…' : 'Save temporary change'}</button>
        </div>
        <div className={styles.tempLegend}><span><b>7+ days</b> planned</span><span><b>Under 7 days</b> late notice</span><span><b>Under 24h</b> urgent</span></div>
        <div className={styles.actions}>
          <button className="btn-secondary" type="button" disabled={availabilityBusy} onClick={() => { setShowTemporaryForm(false); setMessage(null) }}>Cancel</button>
        </div>
      </div> : null}

      {activeEntries.length ? <div className={styles.tempList}>{activeEntries.map((entry) => <article className={styles.tempRow} key={entry.id}>
        <div><strong>{formatOperationalDateTime(entry.startsAt)} → {formatOperationalDateTime(entry.endsAt)}</strong><span>{entry.reason || 'No reason added'}</span></div>
        <span className={`status-badge ${leadLabel(entry.startsAt) === 'Planned' ? 'Completed' : 'Pending'}`}>{leadLabel(entry.startsAt)}</span>
        <button className="btn-secondary" type="button" disabled={busyEntryId === entry.id} onClick={() => void removeTemporary(entry)}>{busyEntryId === entry.id ? 'Removing…' : 'Remove'}</button>
      </article>)}</div> : !showTemporaryForm ? <div className={styles.emptyState}><strong>No temporary changes</strong><span>Your current and upcoming one-off availability changes will appear here.</span></div> : null}
    </section>
  </main>
}
