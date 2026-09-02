'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import DetailDialog from '../ui/DetailDialog'
import OpsIcon from '../ui/OpsIcon'
import StandardSelect from '../ui/StandardSelect'
import GooglePlaceAutocomplete, { type PlaceSelection } from '../workforce/GooglePlaceAutocomplete'
import { localDateTimeToUtc } from '../../modules/scheduling/recurrence'
import './ClientsWorkspace.css'

type TeamMember = { id: string; name?: string | null; email: string }
type Job = {
  id: string
  status: string
  recurrence: unknown
  startDate: string
  endDate?: string | null
  defaultAssignees: Array<{ user: TeamMember }>
  _count: { visits: number }
}
type ServicePlan = {
  id: string
  name: string
  status: string
  expectedDurationMinutes: number
  requiredWorkers: number
  contract?: { id: string; startDate?: string | null; endDate?: string | null; status: string } | null
  tasks: Array<{ id: string; title: string }>
  versions: Array<{ id: string; versionNumber: number; publishedAt: string }>
  jobs: Job[]
}
type Site = {
  id: string
  name: string
  addressLine1: string
  addressLine2?: string | null
  city: string
  postalCode: string
  timezone: string
  access?: { entryInstructions?: string | null } | null
  preferredAssignees: Array<{ user: TeamMember }>
  servicePlans: ServicePlan[]
}
type Client = {
  id: string
  displayName: string
  legalName?: string | null
  type: string
  status: string
  billingEmail?: string | null
  phone?: string | null
  version: number
  contacts: Array<{ id: string; name: string; email?: string | null; phone?: string | null; isPrimary: boolean }>
  contracts: Array<{ id: string; status: string; startDate?: string | null; endDate?: string | null }>
  sites: Site[]
}
type Visit = {
  id: string
  scheduledStart: string
  scheduledEnd: string
  completedAt?: string | null
  status: string
  requiredWorkers?: number
  site: { id: string; name: string }
  assignments?: Array<{ status: string; user: TeamMember }>
}
type AccountData = { client: Client; upcomingVisits: Visit[]; recentVisits: Visit[] }
type Frequency = 'once' | 'daily' | 'weekly' | 'fortnightly'
type ServiceDraft = {
  siteId: string
  serviceName: string
  startDate: string
  endDate: string
  frequency: Frequency
  weekdays: number[]
  time: string
  durationMinutes: number
  requiredWorkers: number
  instructions: string
}
type ChangeTarget = { site: Site; plan: ServicePlan } | null
type ClientPlaceSelection = PlaceSelection & {
  addressLine1: string
  city: string | null
  region: string | null
  postalCode: string | null
  countryCode: string | null
}

const WEEKDAYS = [
  { value: 1, short: 'Mon' }, { value: 2, short: 'Tue' }, { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' }, { value: 5, short: 'Fri' }, { value: 6, short: 'Sat' }, { value: 0, short: 'Sun' },
]
const CLIENT_TYPE_OPTIONS = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'residential', label: 'Residential' },
  { value: 'public_sector', label: 'Public sector' },
  { value: 'internal', label: 'Internal' },
]
const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Every week' },
  { value: 'fortnightly', label: 'Every 2 weeks' },
  { value: 'daily', label: 'Every day' },
  { value: 'once', label: 'One-off' },
]

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

function localDateInput(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatDate(value?: string | null) {
  if (!value) return 'Ongoing'
  return new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`
}

function recurrenceLabel(value: unknown) {
  if (!value || typeof value !== 'object') return 'Schedule configured'
  const rule = value as { frequency?: string; interval?: number; weekdays?: number[] }
  if (rule.frequency === 'once') return 'One-off service'
  if (rule.frequency === 'daily') return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`
  if (rule.frequency === 'weekly') {
    const days = (rule.weekdays ?? []).map((day) => WEEKDAYS.find((item) => item.value === day)?.short).filter(Boolean).join(' · ')
    return `${rule.interval === 2 ? 'Every 2 weeks' : 'Weekly'}${days ? ` · ${days}` : ''}`
  }
  return 'Recurring service'
}

function recurrenceDraft(value: unknown) {
  if (!value || typeof value !== 'object') return { frequency: 'weekly' as Frequency, weekdays: [1] as number[] }
  const rule = value as { frequency?: string; interval?: number; weekdays?: number[] }
  if (rule.frequency === 'once') return { frequency: 'once' as Frequency, weekdays: [] as number[] }
  if (rule.frequency === 'daily') return { frequency: 'daily' as Frequency, weekdays: [] as number[] }
  if (rule.frequency === 'weekly') return { frequency: rule.interval === 2 ? 'fortnightly' as Frequency : 'weekly' as Frequency, weekdays: rule.weekdays ?? [1] }
  return { frequency: 'weekly' as Frequency, weekdays: [1] }
}

function recurrencePayload(draft: Pick<ServiceDraft, 'frequency' | 'weekdays'>) {
  if (draft.frequency === 'once') return { frequency: 'once' as const }
  if (draft.frequency === 'daily') return { frequency: 'daily' as const, interval: 1 }
  return { frequency: 'weekly' as const, interval: draft.frequency === 'fortnightly' ? 2 : 1, weekdays: draft.weekdays }
}

function localStart(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return localDateTimeToUtc({ year, month, day, hour, minute, second: 0 }, timezone)
}

function endOfLocalDate(date: string, timezone: string) {
  if (!date) return null
  return localDateTimeToUtc({
    year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)),
    hour: 23, minute: 59, second: 59,
  }, timezone).toISOString()
}

function timeInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  return `${parts.find((part) => part.type === 'hour')?.value ?? '09'}:${parts.find((part) => part.type === 'minute')?.value ?? '00'}`
}

function newServiceDraft(siteId = ''): ServiceDraft {
  return {
    siteId, serviceName: 'Regular cleaning', startDate: localDateInput(), endDate: '', frequency: 'weekly',
    weekdays: [1], time: '09:00', durationMinutes: 120, requiredWorkers: 1,
    instructions: 'Vacuum floors\nClean bathrooms\nRemove waste',
  }
}

function emptyLocationDraft() {
  return { name: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: 'IE', entryInstructions: '' }
}

export default function ClientAccountWorkspace({ canManageClients, canConfigureService }: { canManageClients: boolean; canConfigureService: boolean }) {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const [data, setData] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)
  const [changeTarget, setChangeTarget] = useState<ChangeTarget>(null)
  const [setupHandled, setSetupHandled] = useState(false)
  const [locationDraft, setLocationDraft] = useState(emptyLocationDraft)
  const [addressQuery, setAddressQuery] = useState('')
  const [selectedPlace, setSelectedPlace] = useState<ClientPlaceSelection | null>(null)
  const [profileDraft, setProfileDraft] = useState({ displayName: '', legalName: '', type: 'commercial', billingEmail: '', phone: '' })
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>(() => newServiceDraft())
  const [changeDraft, setChangeDraft] = useState<ServiceDraft>(() => ({ ...newServiceDraft(), startDate: localDateInput(1) }))

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const account = await api<AccountData>(`/api/client-accounts/${params.id}`)
      setData(account)
      setProfileDraft({
        displayName: account.client.displayName,
        legalName: account.client.legalName ?? '',
        type: account.client.type,
        billingEmail: account.client.billingEmail ?? '',
        phone: account.client.phone ?? '',
      })
      setServiceDraft((current) => ({ ...current, siteId: current.siteId || account.client.sites[0]?.id || '' }))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load this client.' })
    } finally { setLoading(false) }
  }, [params.id])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (setupHandled || !data || searchParams.get('setup') !== '1') return
    setSetupHandled(true)
    if (data.client.sites.length && canConfigureService) {
      setServiceDraft(newServiceDraft(data.client.sites[0].id))
      setServiceOpen(true)
    } else if (canManageClients) setLocationOpen(true)
  }, [canConfigureService, canManageClients, data, searchParams, setupHandled])

  const client = data?.client
  const primaryContact = client?.contacts.find((contact) => contact.isPrimary) ?? client?.contacts[0]
  const serviceCount = client?.sites.reduce((sum, site) => sum + site.servicePlans.length, 0) ?? 0
  const activeServiceCount = client?.sites.reduce((sum, site) => sum + site.servicePlans.filter((plan) => plan.status === 'published' && plan.jobs.some((job) => job.status === 'active')).length, 0) ?? 0

  function toggleWeekday(day: number, mode: 'new' | 'change') {
    const setter = mode === 'new' ? setServiceDraft : setChangeDraft
    setter((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day) ? current.weekdays.filter((value) => value !== day) : [...current.weekdays, day],
    }))
  }

  function selectLocationAddress(place: PlaceSelection) {
    const resolved = place as ClientPlaceSelection
    setSelectedPlace(resolved)
    setAddressQuery(resolved.formattedAddress)
    setLocationDraft((current) => ({
      ...current,
      addressLine1: resolved.addressLine1 || resolved.formattedAddress.split(',')[0]?.trim() || '',
      city: resolved.city || '',
      region: resolved.region || '',
      postalCode: resolved.postalCode || '',
      countryCode: resolved.countryCode || 'IE',
    }))
  }

  async function addLocation(event: FormEvent) {
    event.preventDefault()
    if (!client) return
    if (!selectedPlace) {
      setNotice({ kind: 'error', text: 'Choose the service address from the Google Maps suggestions so routing and geofence checks use a verified location.' })
      return
    }
    if (!locationDraft.addressLine1.trim() || !locationDraft.city.trim() || !locationDraft.postalCode.trim()) {
      setNotice({ kind: 'error', text: 'The selected Google Maps address must include a street, city and Eircode/postcode before this location can be saved.' })
      return
    }
    setBusy(true)
    try {
      const site = await api<{ id: string }>('/api/sites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId: client.id,
          name: client.type === 'residential' ? 'Home' : locationDraft.name.trim() || client.displayName,
          addressLine1: locationDraft.addressLine1,
          addressLine2: locationDraft.addressLine2 || null,
          city: locationDraft.city,
          region: locationDraft.region || null,
          postalCode: locationDraft.postalCode,
          countryCode: locationDraft.countryCode || 'IE', timezone: 'Europe/Dublin',
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
          coordinateSource: 'geocoded',
          geofenceVerifiedM: 150, geofenceNearM: 250, geofenceSuspiciousM: 700,
          access: { entryInstructions: locationDraft.entryInstructions || null },
          areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
          preferredAssigneeIds: [], contractIds: [],
        }),
      })
      setLocationOpen(false)
      setLocationDraft(emptyLocationDraft())
      setAddressQuery('')
      setSelectedPlace(null)
      setServiceDraft(newServiceDraft(site.id))
      setNotice({ kind: 'success', text: 'Verified location added. The account is ready for service setup.' })
      await refresh()
      if (canConfigureService) setServiceOpen(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not add this location.' })
    } finally { setBusy(false) }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!client) return
    setBusy(true)
    try {
      await api(`/api/clients/${client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          version: client.version,
          displayName: profileDraft.displayName,
          legalName: profileDraft.legalName || null,
          type: profileDraft.type,
          billingEmail: profileDraft.billingEmail || null,
          phone: profileDraft.phone || null,
        }),
      })
      setProfileOpen(false)
      setNotice({ kind: 'success', text: 'Client profile updated.' })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not update this client.' })
    } finally { setBusy(false) }
  }

  async function activateService(event: FormEvent) {
    event.preventDefault()
    if (!client) return
    const site = client.sites.find((item) => item.id === serviceDraft.siteId)
    if (!site) return setNotice({ kind: 'error', text: 'Choose a service location first.' })
    const tasks = serviceDraft.instructions.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!tasks.length) return setNotice({ kind: 'error', text: 'Add at least one cleaning instruction.' })
    if ((serviceDraft.frequency === 'weekly' || serviceDraft.frequency === 'fortnightly') && !serviceDraft.weekdays.length) {
      return setNotice({ kind: 'error', text: 'Choose at least one service day.' })
    }
    setBusy(true)
    try {
      const startAt = localStart(serviceDraft.startDate, serviceDraft.time, site.timezone || 'Europe/Dublin')
      const result = await api<{ versionNumber: number; generatedVisits: number }>(`/api/client-accounts/${client.id}/service`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          siteId: site.id,
          serviceName: serviceDraft.serviceName,
          startAt: startAt.toISOString(),
          endDate: endOfLocalDate(serviceDraft.endDate, site.timezone || 'Europe/Dublin'),
          expectedDurationMinutes: Number(serviceDraft.durationMinutes),
          requiredWorkers: Number(serviceDraft.requiredWorkers),
          tasks,
          instructions: tasks.join('\n'),
          recurrence: recurrencePayload(serviceDraft),
        }),
      })
      setServiceOpen(false)
      setServiceDraft(newServiceDraft(site.id))
      setNotice({ kind: 'success', text: `Service activated as version ${result.versionNumber}. ${result.generatedVisits} future visit${result.generatedVisits === 1 ? '' : 's'} generated; staffing stays visible in Schedule.` })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: `${error instanceof Error ? error.message : 'Could not activate this service.'} Nothing was partially created.` })
    } finally { setBusy(false) }
  }

  function openServiceChange(site: Site, plan: ServicePlan) {
    const job = plan.jobs.find((item) => item.status === 'active') ?? plan.jobs[0]
    const recurrence = recurrenceDraft(job?.recurrence)
    setChangeTarget({ site, plan })
    setChangeDraft({
      siteId: site.id,
      serviceName: plan.name,
      startDate: localDateInput(1),
      endDate: plan.contract?.endDate?.slice(0, 10) ?? '',
      frequency: recurrence.frequency,
      weekdays: recurrence.weekdays,
      time: job ? timeInZone(job.startDate, site.timezone || 'Europe/Dublin') : '09:00',
      durationMinutes: plan.expectedDurationMinutes,
      requiredWorkers: plan.requiredWorkers,
      instructions: plan.tasks.map((task) => task.title).join('\n'),
    })
    setChangeOpen(true)
  }

  async function applyServiceChange(event: FormEvent) {
    event.preventDefault()
    if (!client || !changeTarget) return
    const tasks = changeDraft.instructions.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!tasks.length) return setNotice({ kind: 'error', text: 'Add at least one cleaning instruction.' })
    if ((changeDraft.frequency === 'weekly' || changeDraft.frequency === 'fortnightly') && !changeDraft.weekdays.length) {
      return setNotice({ kind: 'error', text: 'Choose at least one service day.' })
    }
    setBusy(true)
    try {
      const effectiveFrom = localStart(changeDraft.startDate, changeDraft.time, changeTarget.site.timezone || 'Europe/Dublin')
      const result = await api<{ versionNumber: number; replacedFutureVisits: number; generatedVisits: number }>(`/api/client-accounts/${client.id}/service-change`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          servicePlanId: changeTarget.plan.id,
          effectiveFrom: effectiveFrom.toISOString(),
          endDate: endOfLocalDate(changeDraft.endDate, changeTarget.site.timezone || 'Europe/Dublin'),
          expectedDurationMinutes: Number(changeDraft.durationMinutes),
          requiredWorkers: Number(changeDraft.requiredWorkers),
          tasks,
          instructions: tasks.join('\n'),
          recurrence: recurrencePayload(changeDraft),
        }),
      })
      setChangeOpen(false)
      setChangeTarget(null)
      setNotice({ kind: 'success', text: `Future service updated. ${result.replacedFutureVisits} planned visit${result.replacedFutureVisits === 1 ? '' : 's'} replaced and ${result.generatedVisits} regenerated. Past work and manually-added extra visits were preserved.` })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not apply this future service change.' })
    } finally { setBusy(false) }
  }

  if (loading && !client) return <main className="page-shell client-account-page"><div className="client-loading">Loading client account…</div></main>
  if (!client || !data) return <main className="page-shell client-account-page"><div className="client-loading">Client account could not be loaded.</div></main>

  return <main className="page-shell client-account-page">
    <header className="client-account-hero">
      <div>
        <a href="/clients" className="client-back">← Clients</a>
        <span className="client-eyebrow">Client account</span>
        <div className="client-title-row"><h1>{client.displayName}</h1><span className={`client-state ${client.status}`}>{client.status}</span></div>
        <p>{client.type === 'residential' ? 'Residential cleaning account' : 'Commercial cleaning account'} · {client.sites.length} location{client.sites.length === 1 ? '' : 's'} · {activeServiceCount} active service{activeServiceCount === 1 ? '' : 's'}</p>
      </div>
      <div className="client-hero-actions">
        {canManageClients ? <button className="client-button-secondary" onClick={() => setProfileOpen(true)}><OpsIcon name="user" />Edit profile</button> : null}
        {canManageClients ? <button className="client-button-secondary" onClick={() => setLocationOpen(true)}><OpsIcon name="field" />Add location</button> : null}
        {canConfigureService ? <button className="client-button" onClick={() => client.sites.length ? (setServiceDraft(newServiceDraft(client.sites[0].id)), setServiceOpen(true)) : setLocationOpen(true)}><OpsIcon name="calendar" />Set up service</button> : null}
      </div>
    </header>

    {notice ? <div className={`client-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

    <section className="client-account-metrics">
      <article><span>Locations</span><strong>{client.sites.length}</strong><small>Where your team delivers service</small></article>
      <article><span>Services</span><strong>{serviceCount}</strong><small>{activeServiceCount} currently active</small></article>
      <article><span>Upcoming</span><strong>{data.upcomingVisits.length}</strong><small>Next visits in the generated horizon</small></article>
      <article><span>Agreement</span><strong>{client.contracts.some((contract) => contract.status === 'active') ? 'Active' : 'Setup'}</strong><small>{client.contracts[0]?.endDate ? `Through ${formatDate(client.contracts[0].endDate)}` : 'No fixed end date'}</small></article>
    </section>

    <div className="client-account-grid">
      <section className="client-section client-profile-card"><div className="client-section-head"><div><span className="client-eyebrow">Profile</span><h2>Client details</h2></div></div><div className="client-facts"><div><span>Primary contact</span><strong>{primaryContact?.name ?? 'Not set'}</strong><small>{primaryContact?.email ?? primaryContact?.phone ?? 'No contact detail'}</small></div><div><span>Billing</span><strong>{client.billingEmail || 'Not set'}</strong><small>{client.phone || 'No client phone'}</small></div></div></section>

      <section className="client-section client-locations-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Locations</span><h2>Where we clean</h2></div>{canManageClients ? <button className="client-text-button" onClick={() => setLocationOpen(true)}>Add location</button> : null}</div>
        <div className="client-location-list">{client.sites.map((site) => <article className="client-location-card" key={site.id}><div className="client-location-icon"><OpsIcon name="field" /></div><div className="client-location-copy"><strong>{site.name}</strong><span>{site.addressLine1}{site.addressLine2 ? `, ${site.addressLine2}` : ''}</span><small>{site.city} · {site.postalCode}</small>{site.access?.entryInstructions ? <p>{site.access.entryInstructions}</p> : null}</div><div className="client-location-meta"><span>{site.servicePlans.length} service{site.servicePlans.length === 1 ? '' : 's'}</span><small>{site.preferredAssignees.length ? `${site.preferredAssignees.length} preferred cleaner${site.preferredAssignees.length === 1 ? '' : 's'}` : 'Team managed in Schedule'}</small></div></article>)}{!client.sites.length ? <div className="client-empty"><strong>No service location yet</strong><span>Add the verified address where cleaning will happen.</span>{canManageClients ? <button className="client-button" onClick={() => setLocationOpen(true)}>Add first location</button> : null}</div> : null}</div>
      </section>

      <section className="client-section client-services-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Service</span><h2>What we agreed to deliver</h2></div>{canConfigureService && client.sites.length ? <button className="client-text-button" onClick={() => { setServiceDraft(newServiceDraft(client.sites[0].id)); setServiceOpen(true) }}>Set up another service</button> : null}</div>
        <div className="client-service-list">
          {client.sites.flatMap((site) => site.servicePlans.map((plan) => {
            const job = plan.jobs.find((item) => item.status === 'active') ?? plan.jobs[0]
            return <article className="client-service-card" key={plan.id}><div className="client-service-top"><div><strong>{plan.name}</strong><span>{site.name}</span></div><span className={`client-state ${job?.status === 'active' ? 'active' : plan.status}`}>{job?.status === 'active' ? 'active' : plan.status}</span></div><div className="client-service-summary"><div><span>Frequency</span><strong>{job ? recurrenceLabel(job.recurrence) : 'Not scheduled yet'}</strong></div><div><span>People required</span><strong>{plan.requiredWorkers} cleaner{plan.requiredWorkers === 1 ? '' : 's'}</strong></div><div><span>Expected duration</span><strong>{durationLabel(plan.expectedDurationMinutes)}</strong></div><div><span>Contract</span><strong>{plan.contract?.endDate ? `to ${formatDate(plan.contract.endDate)}` : 'Ongoing'}</strong></div></div><div className="client-service-instructions"><span>Cleaning instructions</span>{plan.tasks.slice(0, 6).map((task) => <p key={task.id}>✓ {task.title}</p>)}{plan.tasks.length > 6 ? <small>+ {plan.tasks.length - 6} more tasks</small> : null}</div><div className="client-service-foot"><span>{plan.versions[0] ? `Service version ${plan.versions[0].versionNumber}` : 'Draft service'} · {job ? `${job._count.visits} generated visits` : 'No visits generated'}</span>{canConfigureService && plan.versions[0] ? <button className="client-text-button" onClick={() => openServiceChange(site, plan)}>Change service</button> : null}</div></article>
          }))}
          {!serviceCount ? <div className="client-empty"><strong>No cleaning service configured</strong><span>Define frequency, People required, Expected duration and Cleaning instructions in one setup.</span>{canConfigureService && client.sites.length ? <button className="client-button" onClick={() => { setServiceDraft(newServiceDraft(client.sites[0].id)); setServiceOpen(true) }}>Set up first service</button> : null}</div> : null}
        </div>
      </section>

      <section className="client-section client-schedule-section"><div className="client-section-head"><div><span className="client-eyebrow">Schedule</span><h2>Upcoming work</h2></div></div><div className="client-visit-list">{data.upcomingVisits.map((visit) => <article key={visit.id}><div><strong>{formatDateTime(visit.scheduledStart)}</strong><span>{visit.site.name}</span></div><div><span>{visit.assignments?.length ?? 0}/{visit.requiredWorkers ?? 0} cleaners</span><small>{visit.status.replaceAll('_', ' ')}</small></div></article>)}{!data.upcomingVisits.length ? <div className="client-empty compact"><strong>No upcoming visits</strong><span>Set up a service here, or add an extra Visit from Schedule.</span></div> : null}</div></section>

      <section className="client-section client-activity-section"><div className="client-section-head"><div><span className="client-eyebrow">Activity</span><h2>Recent completed work</h2></div></div><div className="client-visit-list">{data.recentVisits.map((visit) => <article key={visit.id}><div><strong>{formatDateTime(visit.scheduledStart)}</strong><span>{visit.site.name}</span></div><span className="client-state active">completed</span></article>)}{!data.recentVisits.length ? <div className="client-empty compact"><strong>No completed visits yet</strong><span>Completed work will build the client history here.</span></div> : null}</div></section>
    </div>

    <DetailDialog open={profileOpen} title="Edit client profile" eyebrow="Client account" onClose={() => setProfileOpen(false)}>
      <form className="client-dialog-form" onSubmit={saveProfile}><label>Client name<input required value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} /></label><label>Legal name <small>Optional</small><input value={profileDraft.legalName} onChange={(event) => setProfileDraft({ ...profileDraft, legalName: event.target.value })} /></label><div className="client-form-field"><span>Client type</span><StandardSelect value={profileDraft.type} onChange={(value) => setProfileDraft({ ...profileDraft, type: value })} ariaLabel="Client type" options={CLIENT_TYPE_OPTIONS} /></div><div className="client-form-pair"><label>Billing email<input type="email" value={profileDraft.billingEmail} onChange={(event) => setProfileDraft({ ...profileDraft, billingEmail: event.target.value })} /></label><label>Phone<input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} /></label></div><div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setProfileOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>Save changes</button></div></form>
    </DetailDialog>

    <DetailDialog open={locationOpen} title="Add service location" eyebrow="Where we clean" onClose={() => setLocationOpen(false)}>
      <form className="client-dialog-form" onSubmit={addLocation}>
        {client.type === 'residential' ? <div className="client-setup-note"><OpsIcon name="map" /><div><strong>Location: Home</strong><span>Residential locations use Home automatically. Confirm the verified address below.</span></div></div> : <label>Location name <small>Optional · e.g. Ranelagh Clinic</small><input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder="Site name" /></label>}
        <GooglePlaceAutocomplete kind="home" label="Service address" value={addressQuery} placeholder="Start typing an address or Eircode…" selected={selectedPlace} onValueChange={(value) => { setAddressQuery(value); if (selectedPlace && value !== selectedPlace.formattedAddress) { setSelectedPlace(null); setLocationDraft((current) => ({ ...current, addressLine1: '', city: '', region: '', postalCode: '' })) } }} onSelect={selectLocationAddress} helpText="Required · choose the Google Maps result. Its verified coordinates power Map, routing and geofence checks." />
        <label>Address line 2 <small>Optional</small><input value={locationDraft.addressLine2} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine2: event.target.value })} placeholder="Unit, floor or building detail" /></label>
        <div className="client-form-pair"><label>City <small>From Google Maps</small><input readOnly aria-readonly="true" value={locationDraft.city} placeholder="Select an address above" /></label><label>Eircode / postcode <small>From Google Maps</small><input readOnly aria-readonly="true" value={locationDraft.postalCode} placeholder="Select an address above" /></label></div>
        <label>Entry notes <small>Optional · door, reception, keys</small><textarea rows={3} value={locationDraft.entryInstructions} onChange={(event) => setLocationDraft({ ...locationDraft, entryInstructions: event.target.value })} /></label>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setLocationOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>Save verified location</button></div>
      </form>
    </DetailDialog>

    <DetailDialog open={serviceOpen} title="Set up cleaning service" eyebrow="Simple service setup" onClose={() => setServiceOpen(false)}>
      <form className="client-dialog-form service-setup-form" onSubmit={activateService}>
        <div className="client-setup-note"><OpsIcon name="check" /><div><strong>Define the service once</strong><span>Diamond creates the contract, protected service version and future Visits behind the scenes.</span></div></div>
        <div className="client-form-field"><span>Location</span><StandardSelect searchable={client.sites.length > 8} value={serviceDraft.siteId} onChange={(value) => setServiceDraft({ ...serviceDraft, siteId: value })} ariaLabel="Service location" placeholder="Select location" searchPlaceholder="Search location…" options={client.sites.map((site) => ({ value: site.id, label: site.name, description: `${site.city} · ${site.postalCode}` }))} /></div>
        <label>Service name<input required value={serviceDraft.serviceName} onChange={(event) => setServiceDraft({ ...serviceDraft, serviceName: event.target.value })} /></label>
        <div className="client-form-pair"><label>Service starts<input required type="date" value={serviceDraft.startDate} onChange={(event) => setServiceDraft({ ...serviceDraft, startDate: event.target.value })} /></label><label>Contract ends <small>Optional</small><input type="date" min={serviceDraft.startDate} value={serviceDraft.endDate} onChange={(event) => setServiceDraft({ ...serviceDraft, endDate: event.target.value })} /></label></div>
        <div className="client-form-pair"><div className="client-form-field"><span>Frequency</span><StandardSelect value={serviceDraft.frequency} onChange={(value) => setServiceDraft({ ...serviceDraft, frequency: value as Frequency })} ariaLabel="Service frequency" options={FREQUENCY_OPTIONS} /></div><label>Preferred time<input required type="time" value={serviceDraft.time} onChange={(event) => setServiceDraft({ ...serviceDraft, time: event.target.value })} /></label></div>
        {(serviceDraft.frequency === 'weekly' || serviceDraft.frequency === 'fortnightly') ? <fieldset className="client-weekdays"><legend>Service days</legend><div>{WEEKDAYS.map((day) => <button type="button" key={day.value} className={serviceDraft.weekdays.includes(day.value) ? 'selected' : ''} onClick={() => toggleWeekday(day.value, 'new')}>{day.short}</button>)}</div></fieldset> : null}
        <div className="client-form-pair"><label>People required<input required type="number" min={1} max={100} value={serviceDraft.requiredWorkers} onChange={(event) => setServiceDraft({ ...serviceDraft, requiredWorkers: Number(event.target.value) })} /></label><label>Expected duration <span className="client-inline-duration">minutes</span><input required type="number" min={15} max={1440} step={15} value={serviceDraft.durationMinutes} onChange={(event) => setServiceDraft({ ...serviceDraft, durationMinutes: Number(event.target.value) })} /></label></div>
        <label>Cleaning instructions <small>One task per line. Keep this practical for the cleaner.</small><textarea required rows={7} value={serviceDraft.instructions} onChange={(event) => setServiceDraft({ ...serviceDraft, instructions: event.target.value })} /></label>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setServiceOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>{busy ? 'Activating…' : 'Activate service'}</button></div>
      </form>
    </DetailDialog>

    <DetailDialog open={changeOpen} title="Change cleaning service" eyebrow="Future service change" onClose={() => setChangeOpen(false)}>
      <form className="client-dialog-form service-setup-form" onSubmit={applyServiceChange}>
        <div className="client-change-note"><OpsIcon name="calendar" /><div><strong>Past work and extra Visits stay exactly as recorded</strong><span>The current service remains valid until the effective date. Only future Visits generated by the recurring rule are replaced.</span></div></div>
        <div className="client-change-current"><span>Current service</span><strong>{changeTarget?.plan.name ?? ''}</strong><small>{changeTarget?.site.name ?? ''} · version {changeTarget?.plan.versions[0]?.versionNumber ?? '—'}</small></div>
        <div className="client-form-pair"><label>Effective from<input required type="date" min={localDateInput()} value={changeDraft.startDate} onChange={(event) => setChangeDraft({ ...changeDraft, startDate: event.target.value })} /></label><label>Contract ends <small>Optional</small><input type="date" min={changeDraft.startDate} value={changeDraft.endDate} onChange={(event) => setChangeDraft({ ...changeDraft, endDate: event.target.value })} /></label></div>
        <div className="client-form-pair"><div className="client-form-field"><span>Frequency</span><StandardSelect value={changeDraft.frequency} onChange={(value) => setChangeDraft({ ...changeDraft, frequency: value as Frequency })} ariaLabel="Service frequency" options={FREQUENCY_OPTIONS} /></div><label>Preferred time<input required type="time" value={changeDraft.time} onChange={(event) => setChangeDraft({ ...changeDraft, time: event.target.value })} /></label></div>
        {(changeDraft.frequency === 'weekly' || changeDraft.frequency === 'fortnightly') ? <fieldset className="client-weekdays"><legend>Service days</legend><div>{WEEKDAYS.map((day) => <button type="button" key={day.value} className={changeDraft.weekdays.includes(day.value) ? 'selected' : ''} onClick={() => toggleWeekday(day.value, 'change')}>{day.short}</button>)}</div></fieldset> : null}
        <div className="client-form-pair"><label>People required<input required type="number" min={1} max={100} value={changeDraft.requiredWorkers} onChange={(event) => setChangeDraft({ ...changeDraft, requiredWorkers: Number(event.target.value) })} /></label><label>Expected duration <span className="client-inline-duration">minutes</span><input required type="number" min={15} max={1440} step={15} value={changeDraft.durationMinutes} onChange={(event) => setChangeDraft({ ...changeDraft, durationMinutes: Number(event.target.value) })} /></label></div>
        <label>Cleaning instructions <small>One task per line. These become the new service version.</small><textarea required rows={7} value={changeDraft.instructions} onChange={(event) => setChangeDraft({ ...changeDraft, instructions: event.target.value })} /></label>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setChangeOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>{busy ? 'Applying…' : 'Apply future change'}</button></div>
      </form>
    </DetailDialog>
  </main>
}
