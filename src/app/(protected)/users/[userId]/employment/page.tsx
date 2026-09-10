'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import GooglePlaceAutocomplete, { type PlaceSelection } from '../../../../../components/workforce/GooglePlaceAutocomplete'
import WeeklyWindowEditor, { type WeeklyRule } from '../../../../../components/workforce/WeeklyWindowEditor'

type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
type RecurringRule = StudyRule & { reason: string | null }
type Profile = {
  phone: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  employmentStartDate: string | null
  homeAddress: string
  homeLatitude: number | null
  homeLongitude: number | null
  schoolName: string | null
  schoolAddress: string | null
  schoolLatitude: number | null
  schoolLongitude: number | null
  weeklyTargetMinutes: number
  weeklyTargetConfigured: boolean
  travelMode: 'driving' | 'transit' | 'cycling'
  studySchedules: StudyRule[]
  recurringUnavailability: RecurringRule[]
}
type Data = {
  user: { id: string; name: string | null; email: string; status: string }
  profile: Profile | null
  temporaryAvailability: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null; createdAt: string }>
  setupRequired: boolean
}

const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const availabilityTime = (value: string) => new Date(value).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })

export default function EmployeeSettingsPage() {
  const params = useParams<{ userId: string }>()
  const userId = params.userId
  const [data, setData] = useState<Data | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [weeklyHours, setWeeklyHours] = useState('')
  const [startDate, setStartDate] = useState('')
  const [identityBusy, setIdentityBusy] = useState(false)
  const [employmentBusy, setEmploymentBusy] = useState(false)
  const [assistBusy, setAssistBusy] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [schoolEnabled, setSchoolEnabled] = useState(false)
  const [schoolQuery, setSchoolQuery] = useState('')
  const [schoolPlace, setSchoolPlace] = useState<PlaceSelection | null>(null)
  const [studyRules, setStudyRules] = useState<WeeklyRule[]>([])
  const [recurringRules, setRecurringRules] = useState<WeeklyRule[]>([])
  const [temporaryFrom, setTemporaryFrom] = useState('')
  const [temporaryTo, setTemporaryTo] = useState('')
  const [temporaryReason, setTemporaryReason] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    const response = await fetch(`/api/workforce/profiles/${userId}`, { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load employee settings.')
    const next = body.data as Data
    setData(next)
    setName(next.user.name ?? '')
    setEmail(next.user.email)
    setWeeklyHours(next.profile?.weeklyTargetConfigured ? String(next.profile.weeklyTargetMinutes / 60) : '')
    setStartDate(next.profile?.employmentStartDate ? next.profile.employmentStartDate.slice(0, 10) : '')
    setSchoolEnabled(Boolean(next.profile?.schoolAddress))
    setSchoolQuery(next.profile?.schoolName ?? next.profile?.schoolAddress ?? '')
    setSchoolPlace(next.profile?.schoolAddress && next.profile.schoolLatitude != null && next.profile.schoolLongitude != null ? {
      placeId: 'existing-school',
      displayName: next.profile.schoolName,
      formattedAddress: next.profile.schoolAddress,
      latitude: next.profile.schoolLatitude,
      longitude: next.profile.schoolLongitude,
      types: ['establishment'],
    } : null)
    setStudyRules(next.profile?.studySchedules ?? [])
    setRecurringRules(next.profile?.recurringUnavailability ?? [])
  }, [userId])

  useEffect(() => {
    void load().catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [load])

  useEffect(() => {
    if (!message || message.type === 'error') return
    const timer = window.setTimeout(() => setMessage(null), 3600)
    return () => window.clearTimeout(timer)
  }, [message])

  async function saveIdentity() {
    const nextName = name.trim()
    const nextEmail = email.trim().toLowerCase()
    if (nextName.length < 2) { setMessage({ type: 'error', text: 'Enter a valid full name.' }); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) { setMessage({ type: 'error', text: 'Enter a valid work email.' }); return }
    if (data && nextEmail !== data.user.email && !window.confirm(`Change this person's login email to ${nextEmail}? They must use the new email the next time they sign in.`)) return

    setIdentityBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/users/${userId}/identity`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName, email: nextEmail }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not update identity.')
      setMessage({ type: 'success', text: 'Name and login email updated by the administrator.' })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not update identity.' })
    } finally {
      setIdentityBusy(false)
    }
  }

  async function saveEmployment() {
    const hours = Number(weeklyHours)
    if (!data?.profile) {
      setMessage({ type: 'error', text: 'This employee must complete My profile first. No placeholder home or availability data will be created.' })
      return
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 60) {
      setMessage({ type: 'error', text: 'Enter the real weekly target between 1 and 60 hours.' })
      return
    }

    setEmploymentBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/workforce/profiles/${userId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyTargetMinutes: Math.round(hours * 60), employmentStartDate: startDate || null }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save employment settings.')
      setData(body.data)
      setMessage({ type: 'success', text: 'Company-owned employment settings saved.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save employment settings.' })
    } finally {
      setEmploymentBusy(false)
    }
  }

  async function saveAssistedScheduling() {
    if (!data?.profile) return
    if (schoolEnabled && !schoolPlace) {
      setMessage({ type: 'error', text: 'Choose the school or college from the mapped address results before saving.' })
      return
    }
    setAssistBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/workforce/profiles/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school: schoolEnabled && schoolPlace ? {
            name: (schoolPlace.displayName ?? schoolQuery.trim()) || 'School',
            address: schoolPlace.formattedAddress,
          } : null,
          studySchedule: schoolEnabled ? studyRules.map(({ dayOfWeek, startsMinute, endsMinute }) => ({ dayOfWeek, startsMinute, endsMinute })) : [],
          recurringUnavailability: recurringRules.map(({ dayOfWeek, startsMinute, endsMinute, reason }) => ({ dayOfWeek, startsMinute, endsMinute, reason: reason?.trim() || null })),
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save assisted scheduling profile.')
      setMessage({ type: 'success', text: 'Employee scheduling profile updated. The admin change is recorded in the audit trail.' })
      setAssistOpen(false)
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save assisted scheduling profile.' })
    } finally {
      setAssistBusy(false)
    }
  }

  async function addTemporaryAvailability() {
    if (!temporaryFrom || !temporaryTo) {
      setMessage({ type: 'error', text: 'Choose the start and end of the temporary unavailability.' })
      return
    }
    const startsAt = new Date(temporaryFrom)
    const endsAt = new Date(temporaryTo)
    if (!(endsAt > startsAt)) {
      setMessage({ type: 'error', text: 'Temporary unavailability must end after it starts.' })
      return
    }
    setAssistBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          reason: temporaryReason.trim() || null,
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not add temporary unavailability.')
      setTemporaryFrom('')
      setTemporaryTo('')
      setTemporaryReason('')
      setMessage({ type: 'success', text: 'Temporary unavailability added for this employee.' })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not add temporary unavailability.' })
    } finally {
      setAssistBusy(false)
    }
  }

  async function removeTemporaryAvailability(id: string) {
    if (!window.confirm('Remove this temporary unavailability? Published visits will not be moved automatically.')) return
    setAssistBusy(true)
    setMessage(null)
    try {
      const response = await fetch(`/api/availability/${id}`, { method: 'DELETE' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not remove temporary unavailability.')
      setMessage({ type: 'success', text: 'Temporary unavailability removed.' })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not remove temporary unavailability.' })
    } finally {
      setAssistBusy(false)
    }
  }

  return <main className="page-shell">
    <header className="page-header">
      <div><span className="eyebrow">People & access</span><h1>Employee settings</h1><p className="muted">Admins own account and employment settings, and can assist with mapped school, study hours or availability when an employee cannot update them alone.</p></div>
      <a className="btn-secondary" href="/users">← People & access</a>
    </header>

    {message ? message.type === 'success' ? <div className="transient-notice success" role="status"><span>{message.text}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div> : <div className="toast error" role="alert">{message.text}</div> : null}

    {!data ? <section className="card empty-state">Loading employee…</section> : <>
      <section className="card">
        <div className="section-heading"><div><h2>Identity & login</h2><p className="muted">Only an administrator can change these fields after the invitation is created.</p></div></div>
        <div className="admin-form-grid">
          <label><span>Full name</span><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Work email / login</span><input type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} /></label>
          <button className="btn-primary" type="button" disabled={identityBusy} onClick={() => void saveIdentity()}>{identityBusy ? 'Saving…' : 'Save identity'}</button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading"><div><h2>Employment settings</h2><p className="muted">Company-owned planning fields. These never appear as editable employee profile fields.</p></div></div>
        {!data.profile ? <div className="toast error" role="status"><strong>Waiting for employee profile.</strong> Ask this person to complete My profile first.</div> : null}
        <div className="admin-form-grid">
          <label><span>Weekly target hours</span><input type="number" min="1" max="60" step="0.5" disabled={!data.profile} value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} placeholder="Required" /></label>
          <label><span>Employment start date</span><input type="date" disabled={!data.profile} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <button className="btn-primary" type="button" disabled={employmentBusy || !data.profile} onClick={() => void saveEmployment()}>{employmentBusy ? 'Saving…' : 'Save employment settings'}</button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div><h2>Operational profile & availability</h2><p className="muted">Employee-owned by default. An administrator can assist when needed; every assisted scheduling change is audited.</p></div>
          {data.profile ? <button className="btn-secondary" type="button" onClick={() => setAssistOpen((current) => !current)}>{assistOpen ? 'Close assistance' : 'Assist employee'}</button> : null}
        </div>
        {data.profile ? <>
          <div className="admin-form-grid">
            <label><span>Phone</span><input disabled value={data.profile.phone ?? 'Not provided'} /></label>
            <label><span>Mapped home / starting address</span><input disabled value={data.profile.homeAddress} /></label>
            <label><span>Travel mode</span><input disabled value={data.profile.travelMode === 'driving' ? 'Driving' : data.profile.travelMode === 'cycling' ? 'Cycling' : 'Public transport'} /></label>
            <label><span>Emergency contact</span><input disabled value={data.profile.emergencyContactName && data.profile.emergencyContactPhone ? `${data.profile.emergencyContactName} · ${data.profile.emergencyContactPhone}` : 'Not provided'} /></label>
            <label><span>Mapped school / study location</span><input disabled value={data.profile.schoolName && data.profile.schoolAddress ? `${data.profile.schoolName} · ${data.profile.schoolAddress}` : 'Not provided / not applicable'} /></label>
          </div>

          {!assistOpen ? <>
            {data.profile.studySchedules.length ? <div><h3>Study hours</h3>{data.profile.studySchedules.map((rule, index) => <p className="muted" key={`study-${rule.dayOfWeek}-${rule.startsMinute}-${index}`}>{dayNames[rule.dayOfWeek]} · {minutesToTime(rule.startsMinute)}–{minutesToTime(rule.endsMinute)}</p>)}</div> : null}
            {data.profile.recurringUnavailability.length ? <div><h3>Recurring weekly unavailability</h3>{data.profile.recurringUnavailability.map((rule, index) => <p className="muted" key={`recurring-${rule.dayOfWeek}-${rule.startsMinute}-${index}`}>{dayNames[rule.dayOfWeek]} · {minutesToTime(rule.startsMinute)}–{minutesToTime(rule.endsMinute)}{rule.reason ? ` · ${rule.reason}` : ''}</p>)}</div> : <p className="muted">No recurring weekly restrictions declared.</p>}
          </> : <div className="admin-assist-panel">
            <div className="admin-assist-warning"><strong>Admin assistance</strong><span>These changes affect scheduling and route origin. Published visits are never silently moved.</span></div>
            <div className="admin-assist-choice">
              <div><strong>School or college part of the normal week?</strong><small>Turn this off to remove the mapped school and study hours.</small></div>
              <div className="segmented-control"><button type="button" className={!schoolEnabled ? 'selected' : ''} onClick={() => { setSchoolEnabled(false); setSchoolPlace(null); setSchoolQuery(''); setStudyRules([]) }}>No</button><button type="button" className={schoolEnabled ? 'selected' : ''} onClick={() => setSchoolEnabled(true)}>Yes</button></div>
            </div>
            {schoolEnabled ? <GooglePlaceAutocomplete
              kind="school"
              label="Mapped school or college"
              value={schoolQuery}
              selected={schoolPlace}
              placeholder="Search school, college or mapped address…"
              helpText="Choose the real mapped result so routing keeps a verified origin."
              onValueChange={(value) => { setSchoolQuery(value); setSchoolPlace(null) }}
              onSelect={(place) => { setSchoolPlace(place); setSchoolQuery(place.displayName ?? place.formattedAddress); setMessage(null) }}
            /> : null}
            {schoolEnabled ? <div className="admin-assist-block"><div><h3>Study hours</h3><p className="muted">Times when study makes this employee unavailable for work.</p></div><WeeklyWindowEditor value={studyRules} onChange={setStudyRules} emptyText="No recurring study hours." addLabel="Add study hours" defaultStart={540} defaultEnd={750} /></div> : null}
            <div className="admin-assist-block"><div><h3>Recurring weekly unavailability</h3><p className="muted">Other fixed commitments that block scheduling.</p></div><WeeklyWindowEditor value={recurringRules} onChange={setRecurringRules} reasonEnabled emptyText="No recurring weekly restrictions." addLabel="Add unavailable time" defaultStart={1080} defaultEnd={1320} /></div>
            <div className="admin-assist-actions"><button className="btn-secondary" type="button" disabled={assistBusy} onClick={() => { setAssistOpen(false); void load() }}>Cancel</button><button className="btn-primary" type="button" disabled={assistBusy || (schoolEnabled && !schoolPlace)} onClick={() => void saveAssistedScheduling()}>{assistBusy ? 'Saving…' : 'Save assisted profile'}</button></div>
          </div>}

          <div className="admin-temporary-section">
            <div><h3>Current and upcoming temporary changes</h3><p className="muted">Admins can add or remove a one-off unavailable period when the employee cannot do it themselves.</p></div>
            {data.temporaryAvailability.length ? <div className="admin-temporary-list">{data.temporaryAvailability.map((entry) => <div key={entry.id}><span><strong>{availabilityTime(entry.startsAt)} → {availabilityTime(entry.endsAt)}</strong><small>{entry.reason || 'No reason provided'}</small></span><button className="btn-secondary" type="button" disabled={assistBusy} onClick={() => void removeTemporaryAvailability(entry.id)}>Remove</button></div>)}</div> : <p className="muted">No current or upcoming temporary changes.</p>}
            {assistOpen ? <div className="admin-temporary-form"><label><span>Unavailable from</span><input type="datetime-local" value={temporaryFrom} onChange={(event) => setTemporaryFrom(event.target.value)} /></label><label><span>Until</span><input type="datetime-local" value={temporaryTo} onChange={(event) => setTemporaryTo(event.target.value)} /></label><label><span>Reason (optional)</span><input value={temporaryReason} maxLength={240} onChange={(event) => setTemporaryReason(event.target.value)} placeholder="Appointment, family commitment…" /></label><button className="btn-secondary" type="button" disabled={assistBusy} onClick={() => void addTemporaryAvailability()}>Add temporary change</button></div> : null}
          </div>
        </> : <p className="muted">No employee operational profile yet.</p>}
      </section>
    </>}
  </main>
}
