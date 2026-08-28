'use client'

import { useEffect, useState } from 'react'

type Profile = {
  phone: string | null
  home: { label: string; address: string; latitude: number | null; longitude: number | null }
  travelMode: 'driving' | 'transit' | 'cycling'
  emergencyContact: { name: string; phone: string } | null
  weeklyTargetMinutes: number | null
  employmentStartDate: string | null
  school: { name: string; address: string } | null
  studySchedule: Array<{ dayOfWeek: number; startsMinute: number; endsMinute: number }>
}
type Data = {
  user: { id: string; name: string | null; email: string }
  profile: Profile | null
  setupRequired: boolean
  managerSetupRequired: boolean
}
const days = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export default function MyProfilePage() {
  const [data, setData] = useState<Data | null>(null)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [travelMode, setTravelMode] = useState<Profile['travelMode']>('transit')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function load() {
    const response = await fetch('/api/workforce/profile', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load profile.')
    const next = body.data as Data
    setData(next)
    setPhone(next.profile?.phone ?? '')
    setAddress(next.profile?.home.address ?? '')
    setTravelMode(next.profile?.travelMode ?? 'transit')
    setEmergencyName(next.profile?.emergencyContact?.name ?? '')
    setEmergencyPhone(next.profile?.emergencyContact?.phone ?? '')
  }

  useEffect(() => {
    void load().catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [])

  async function save() {
    if (!address.trim()) {
      setMessage({ type: 'error', text: 'Operational starting address is required.' })
      return
    }
    if (Boolean(emergencyName.trim()) !== Boolean(emergencyPhone.trim())) {
      setMessage({ type: 'error', text: 'Enter both emergency contact name and phone, or leave both blank.' })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/workforce/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim() || null,
          home: { address: address.trim() },
          travelMode,
          emergencyContact: emergencyName.trim() && emergencyPhone.trim()
            ? { name: emergencyName.trim(), phone: emergencyPhone.trim() }
            : null,
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save profile.')
      setData(body.data)
      setMessage({
        type: 'success',
        text: body.data.managerSetupRequired
          ? 'Personal details saved. Operations still needs to confirm your weekly target before automatic scheduling.'
          : 'Profile saved. Future route planning can use your updated details.',
      })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save profile.' })
    } finally {
      setBusy(false)
    }
  }

  return <main className="page-shell">
    <header className="page-header">
      <div>
        <span className="eyebrow">My operational profile</span>
        <h1>My profile</h1>
        <p className="muted">Keep your contact and starting-location details accurate. Contract and recurring study rules stay under management control.</p>
      </div>
    </header>

    {message ? <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}

    {!data ? <section className="card empty-state">Loading profile…</section> : <>
      {data.setupRequired ? <section className="card">
        <strong>Setup required</strong>
        <p className="muted">Complete your details below. Automatic scheduling stays off until operations confirms the manager-owned fields.</p>
      </section> : null}

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Personal & operational details</h2>
            <p className="muted">Changing your starting address can affect future routing. Existing published visits are not moved automatically.</p>
          </div>
        </div>
        <div className="admin-form-grid">
          <label><span>Name</span><input value={data.user.name ?? ''} disabled /></label>
          <label><span>Work email</span><input value={data.user.email} disabled /></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+353…" autoComplete="tel" /></label>
          <label><span>Operational starting address</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Home / regular starting address" autoComplete="street-address" /></label>
          <label><span>Main travel mode</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value as Profile['travelMode'])}><option value="driving">Driving</option><option value="transit">Public transport</option><option value="cycling">Cycling</option></select></label>
          <label><span>Emergency contact name (optional)</span><input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} /></label>
          <label><span>Emergency contact phone (optional)</span><input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} autoComplete="tel" /></label>
          <button className="btn-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save my profile'}</button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Managed by operations</h2>
            <p className="muted">These values affect contractual capacity or recurring scheduling and are not self-service.</p>
          </div>
        </div>
        <div className="admin-form-grid">
          <label><span>Weekly target</span><input disabled value={data.profile?.weeklyTargetMinutes == null ? 'Not configured' : `${Math.round(data.profile.weeklyTargetMinutes / 6) / 10} hours`} /></label>
          <label><span>Employment start date</span><input disabled value={data.profile?.employmentStartDate ? new Date(data.profile.employmentStartDate).toLocaleDateString('en-IE') : 'Not configured'} /></label>
          <label><span>School / study location</span><input disabled value={data.profile?.school ? `${data.profile.school.name} · ${data.profile.school.address}` : 'Not configured / not applicable'} /></label>
        </div>
        {data.profile?.studySchedule.length ? <div>
          {data.profile.studySchedule.map((rule, index) => <p className="muted" key={`${rule.dayOfWeek}-${rule.startsMinute}-${index}`}>{days[rule.dayOfWeek]} · {time(rule.startsMinute)}–{time(rule.endsMinute)}</p>)}
        </div> : null}
      </section>
    </>}
  </main>
}
