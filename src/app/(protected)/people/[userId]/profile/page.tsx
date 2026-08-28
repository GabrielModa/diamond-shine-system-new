'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
type RawProfile = {
  phone: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  employmentStartDate: string | null
  homeLabel: string
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
  leaves: Array<{ kind: string; startsAt: string; endsAt: string; reason: string | null }>
}
type Data = {
  user: { id: string; name: string | null; email: string }
  profile: RawProfile | null
  setupRequired: boolean
}

const dayOptions = [
  [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'],
  [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday'],
] as const
const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export default function ConfigureEmployeeProfilePage() {
  const params = useParams<{ userId: string }>()
  const userId = params.userId
  const [data, setData] = useState<Data | null>(null)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [travelMode, setTravelMode] = useState<RawProfile['travelMode']>('transit')
  const [weeklyHours, setWeeklyHours] = useState('')
  const [startDate, setStartDate] = useState('')
  const [emergencyName, setEmergencyName] = useState('')
  const [emergencyPhone, setEmergencyPhone] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [schoolAddress, setSchoolAddress] = useState('')
  const [studyRules, setStudyRules] = useState<StudyRule[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!userId) return

    async function load() {
      const response = await fetch(`/api/workforce/profiles/${userId}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load employee profile.')
      const next = body.data as Data
      setData(next)
      const profile = next.profile
      setPhone(profile?.phone ?? '')
      setAddress(profile?.homeAddress ?? '')
      setTravelMode(profile?.travelMode ?? 'transit')
      setWeeklyHours(profile?.weeklyTargetConfigured ? String(profile.weeklyTargetMinutes / 60) : '')
      setStartDate(profile?.employmentStartDate ? profile.employmentStartDate.slice(0, 10) : '')
      setEmergencyName(profile?.emergencyContactName ?? '')
      setEmergencyPhone(profile?.emergencyContactPhone ?? '')
      setSchoolName(profile?.schoolName ?? '')
      setSchoolAddress(profile?.schoolAddress ?? '')
      setStudyRules(profile?.studySchedules ?? [])
    }

    void load().catch((error) => setMessage({ type: 'error', text: error.message }))
  }, [userId])

  function updateStudyRule(index: number, patch: Partial<StudyRule>) {
    setStudyRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule))
  }

  async function save() {
    const hours = Number(weeklyHours)
    if (!address.trim()) {
      setMessage({ type: 'error', text: 'Operational starting address is required.' })
      return
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 60) {
      setMessage({ type: 'error', text: 'Enter the real weekly target between 1 and 60 hours.' })
      return
    }
    if (Boolean(emergencyName.trim()) !== Boolean(emergencyPhone.trim())) {
      setMessage({ type: 'error', text: 'Enter both emergency contact fields or leave both blank.' })
      return
    }
    if (Boolean(schoolName.trim()) !== Boolean(schoolAddress.trim())) {
      setMessage({ type: 'error', text: 'Enter both school name and school address, or leave both blank.' })
      return
    }
    if (!schoolName.trim() && studyRules.length) {
      setMessage({ type: 'error', text: 'Add the school location before adding recurring study windows.' })
      return
    }
    if (studyRules.some((rule) => rule.endsMinute <= rule.startsMinute)) {
      setMessage({ type: 'error', text: 'Every study window must end after it starts.' })
      return
    }

    setBusy(true)
    setMessage(null)
    try {
      const current = data?.profile
      const homeUnchanged = current?.homeAddress === address.trim()
      const schoolUnchanged = current?.schoolAddress === schoolAddress.trim()
      const school = schoolName.trim() && schoolAddress.trim()
        ? {
            name: schoolName.trim(),
            label: schoolName.trim(),
            address: schoolAddress.trim(),
            latitude: schoolUnchanged ? current?.schoolLatitude ?? null : null,
            longitude: schoolUnchanged ? current?.schoolLongitude ?? null : null,
          }
        : null

      const response = await fetch(`/api/workforce/profiles/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim() || null,
          emergencyContact: emergencyName.trim() && emergencyPhone.trim()
            ? { name: emergencyName.trim(), phone: emergencyPhone.trim() }
            : null,
          employmentStartDate: startDate || null,
          home: {
            label: current?.homeLabel ?? 'Home',
            address: address.trim(),
            latitude: homeUnchanged ? current?.homeLatitude ?? null : null,
            longitude: homeUnchanged ? current?.homeLongitude ?? null : null,
          },
          school,
          weeklyTargetMinutes: Math.round(hours * 60),
          travelMode,
          studySchedule: school ? studyRules : [],
          schoolHolidays: current?.leaves
            .filter((leave) => leave.kind === 'school_holiday')
            .map(({ startsAt, endsAt, reason }) => ({ startsAt, endsAt, reason })) ?? [],
          personalLeaves: current?.leaves
            .filter((leave) => leave.kind === 'personal_leave')
            .map(({ startsAt, endsAt, reason }) => ({ startsAt, endsAt, reason })) ?? [],
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not save employee profile.')
      setMessage({ type: 'success', text: 'Employee setup confirmed. Automatic scheduling can now use this person, subject to availability and conflicts.' })
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save employee profile.' })
    } finally {
      setBusy(false)
    }
  }

  return <main className="page-shell">
    <header className="page-header">
      <div>
        <span className="eyebrow">Workforce setup</span>
        <h1>Configure employee</h1>
        <p className="muted">Management confirms contractual capacity and recurring study rules. Personal details remain editable by the employee.</p>
      </div>
      <a className="btn-secondary" href="/people">← People & coverage</a>
    </header>

    {message ? <div className={`toast ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div> : null}

    {!data ? <section className="card empty-state">Loading employee…</section> : <>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>{data.user.name ?? data.user.email}</h2>
            <p className="muted">{data.user.email} · {data.setupRequired ? 'Setup required' : 'Scheduling setup complete'}</p>
          </div>
        </div>

        <div className="admin-form-grid">
          <label><span>Weekly target hours</span><input type="number" min="1" max="60" step="0.5" value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} placeholder="Required" /><small>Manager-controlled planning target. No default is assumed for a new employee.</small></label>
          <label><span>Employment start date</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label><span>Operational starting address</span><input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
          <label><span>Travel mode</span><select value={travelMode} onChange={(event) => setTravelMode(event.target.value as RawProfile['travelMode'])}><option value="driving">Driving</option><option value="transit">Public transport</option><option value="cycling">Cycling</option></select></label>
          <label><span>Emergency contact name (optional)</span><input value={emergencyName} onChange={(event) => setEmergencyName(event.target.value)} /></label>
          <label><span>Emergency contact phone (optional)</span><input value={emergencyPhone} onChange={(event) => setEmergencyPhone(event.target.value)} /></label>
          <label><span>School / study location (optional)</span><input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} /></label>
          <label><span>School address (optional)</span><input value={schoolAddress} onChange={(event) => setSchoolAddress(event.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Recurring study schedule</h2>
            <p className="muted">Only add recurring windows that should constrain scheduling. One employee can have multiple windows.</p>
          </div>
          <button className="btn-secondary" type="button" onClick={() => setStudyRules((current) => [...current, { dayOfWeek: 1, startsMinute: 540, endsMinute: 1020 }])}>+ Add study window</button>
        </div>

        {studyRules.length ? studyRules.map((rule, index) => <div className="admin-form-grid" key={`${index}-${rule.dayOfWeek}`}>
          <label><span>Day</span><select value={rule.dayOfWeek} onChange={(event) => updateStudyRule(index, { dayOfWeek: Number(event.target.value) })}>{dayOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>From</span><input type="time" value={minutesToTime(rule.startsMinute)} onChange={(event) => updateStudyRule(index, { startsMinute: timeToMinutes(event.target.value) })} /></label>
          <label><span>Until</span><input type="time" value={minutesToTime(rule.endsMinute)} onChange={(event) => updateStudyRule(index, { endsMinute: timeToMinutes(event.target.value) })} /></label>
          <button className="btn-secondary" type="button" onClick={() => setStudyRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))}>Remove</button>
        </div>) : <p className="muted">No recurring study constraint.</p>}
      </section>

      <section className="card">
        <button className="btn-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save & mark ready for scheduling'}</button>
      </section>
    </>}
  </main>
}
