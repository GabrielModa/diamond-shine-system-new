'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

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
  setupRequired: boolean
}

const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

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
  }, [userId])

  useEffect(() => {
    void load().catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [load])

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

  return <main className="page-shell">
    <header className="page-header">
      <div><span className="eyebrow">People & access</span><h1>Employee settings</h1><p className="muted">Admins own account identity, access and employment terms. The employee owns contact, mapped locations and recurring availability.</p></div>
      <a className="btn-secondary" href="/users">← People & access</a>
    </header>

    {message ? <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}

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
        <div className="section-heading"><div><h2>Employee-provided operational profile</h2><p className="muted">Read-only here. These values come from the employee and are validated/audited by the profile workflow.</p></div></div>
        {data.profile ? <>
          <div className="admin-form-grid">
            <label><span>Phone</span><input disabled value={data.profile.phone ?? 'Not provided'} /></label>
            <label><span>Mapped home / starting address</span><input disabled value={data.profile.homeAddress} /></label>
            <label><span>Travel mode</span><input disabled value={data.profile.travelMode === 'driving' ? 'Driving' : data.profile.travelMode === 'cycling' ? 'Cycling' : 'Public transport'} /></label>
            <label><span>Emergency contact</span><input disabled value={data.profile.emergencyContactName && data.profile.emergencyContactPhone ? `${data.profile.emergencyContactName} · ${data.profile.emergencyContactPhone}` : 'Not provided'} /></label>
            <label><span>Mapped school / study location</span><input disabled value={data.profile.schoolName && data.profile.schoolAddress ? `${data.profile.schoolName} · ${data.profile.schoolAddress}` : 'Not provided / not applicable'} /></label>
          </div>
          {data.profile.studySchedules.length ? <div><h3>Study hours</h3>{data.profile.studySchedules.map((rule, index) => <p className="muted" key={`study-${rule.dayOfWeek}-${rule.startsMinute}-${index}`}>{dayNames[rule.dayOfWeek]} · {minutesToTime(rule.startsMinute)}–{minutesToTime(rule.endsMinute)}</p>)}</div> : null}
          {data.profile.recurringUnavailability.length ? <div><h3>Recurring weekly unavailability</h3>{data.profile.recurringUnavailability.map((rule, index) => <p className="muted" key={`recurring-${rule.dayOfWeek}-${rule.startsMinute}-${index}`}>{dayNames[rule.dayOfWeek]} · {minutesToTime(rule.startsMinute)}–{minutesToTime(rule.endsMinute)}{rule.reason ? ` · ${rule.reason}` : ''}</p>)}</div> : <p className="muted">No recurring weekly restrictions declared.</p>}
        </> : <p className="muted">No employee operational profile yet.</p>}
      </section>
    </>}
  </main>
}
