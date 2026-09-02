'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import DetailDialog from '../ui/DetailDialog'
import OpsIcon from '../ui/OpsIcon'
import { localDateTimeToUtc } from '../../modules/scheduling/recurrence'
import './ClientsWorkspace.css'

type Contact = { id: string; name: string; role?: string | null; email?: string | null; phone?: string | null; isPrimary: boolean }
type TeamMember = { id: string; name?: string | null; email: string }
type Job = {
  id: string
  name: string
  status: string
  recurrence: unknown
  startDate: string
  endDate?: string | null
  defaultDurationMin: number
  requiredWorkers: number
  generatedThrough?: string | null
  instructions?: string | null
  defaultAssignees: Array<{ user: TeamMember }>
  _count: { visits: number }
}
type ServicePlan = {
  id: string
  name: string
  description?: string | null
  status: string
  expectedDurationMinutes: number
  requiredWorkers: number
  version: number
  contract?: { id: string; name: string; startDate?: string | null; endDate?: string | null; status: string } | null
  tasks: Array<{ id: string; title: string; instructions?: string | null; required: boolean }>
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
  access?: { entryInstructions?: string | null; parkingInstructions?: string | null; alarmInstructions?: string | null } | null
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
  contacts: Contact[]
  contracts: Array<{ id: string; name: string; status: string; startDate?: string | null; endDate?: string | null }>
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

const WEEKDAYS = [
  { value: 1, short: 'Mon' }, { value: 2, short: 'Tue' }, { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' }, { value: 5, short: 'Fri' }, { value: 6, short: 'Sat' }, { value: 0, short: 'Sun' },
]

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
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

function localStart(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return localDateTimeToUtc({ year, month, day, hour, minute, second: 0 }, timezone)
}

export default function ClientAccount({ canManageClients, canConfigureService }: { canManageClients: boolean; canConfigureService: boolean }) {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const [data, setData] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [locationOpen, setLocationOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [setupHandled, setSetupHandled] = useState(false)
  const [locationDraft, setLocationDraft] = useState({ name: '', addressLine1: '', addressLine2: '', city: 'Dublin', postalCode: '', entryInstructions: '' })
  const [profileDraft, setProfileDraft] = useState({ displayName: '', legalName: '', type: 'commercial', billingEmail: '', phone: '' })
  const today = useMemo(() => {
    const now = new Date()
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    return local.toISOString().slice(0, 10)
  }, [])
  const [serviceDraft, setServiceDraft] = useState({
    siteId: '', serviceName: 'Regular cleaning', startDate: today, endDate: '', frequency: 'weekly' as Frequency,
    weekdays: [1] as number[], time: '09:00', durationMinutes: 120, requiredWorkers: 1,
    instructions: 'Vacuum floors\nClean bathrooms\nRemove waste',
  })

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
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (setupHandled || !data || searchParams.get('setup') !== '1') return
    setSetupHandled(true)
    if (data.client.sites.length && canConfigureService) setServiceOpen(true)
    else if (canManageClients) setLocationOpen(true)
  }, [canConfigureService, canManageClients, data, searchParams, setupHandled])

  const primaryContact = data?.client.contacts.find((contact) => contact.isPrimary) ?? data?.client.contacts[0]
  const serviceCount = data?.client.sites.reduce((sum, site) => sum + site.servicePlans.length, 0) ?? 0
  const activeServiceCount = data?.client.sites.reduce((sum, site) => sum + site.servicePlans.filter((plan) => plan.status === 'published' && plan.jobs.some((job) => job.status === 'active')).length, 0) ?? 0

  async function addLocation(event: FormEvent) {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    try {
      const site = await api<{ id: string }>('/api/sites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId: data.client.id,
          name: locationDraft.name || (data.client.type === 'residential' ? 'Home' : data.client.displayName),
          addressLine1: locationDraft.addressLine1,
          addressLine2: locationDraft.addressLine2 || null,
          city: locationDraft.city,
          postalCode: locationDraft.postalCode,
          countryCode: 'IE', timezone: 'Europe/Dublin',
          geofenceVerifiedM: 150, geofenceNearM: 250, geofenceSuspiciousM: 700,
          access: { entryInstructions: locationDraft.entryInstructions || null },
          areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
          preferredAssigneeIds: [], contractIds: [],
        }),
      })
      setLocationOpen(false)
      setLocationDraft({ name: '', addressLine1: '', addressLine2: '', city: 'Dublin', postalCode: '', entryInstructions: '' })
      setServiceDraft((current) => ({ ...current, siteId: site.id }))
      setNotice({ kind: 'success', text: 'Location added. You can now define the cleaning service.' })
      await refresh()
      if (canConfigureService) setServiceOpen(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not add this location.' })
    } finally { setBusy(false) }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    try {
      await api(`/api/clients/${data.client.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          version: data.client.version,
          displayName: profileDraft.displayName,
          legalName: profileDraft.legalName || null,
          type: profileDraft.type,
          billingEmail: profileDraft.billingEmail || null,
          phone: profileDraft.phone || null,
        }),
      })
      setEditOpen(false)
      setNotice({ kind: 'success', text: 'Client profile updated.' })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not update the client.' })
    } finally { setBusy(false) }
  }

  async function setupService(event: FormEvent) {
    event.preventDefault()
    if (!data) return
    const site = data.client.sites.find((item) => item.id === serviceDraft.siteId)
    if (!site) return setNotice({ kind: 'error', text: 'Choose a service location first.' })
    const taskTitles = serviceDraft.instructions.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!taskTitles.length) return setNotice({ kind: 'error', text: 'Add at least one cleaning instruction.' })
    if ((serviceDraft.frequency === 'weekly' || serviceDraft.frequency === 'fortnightly') && !serviceDraft.weekdays.length) {
      return setNotice({ kind: 'error', text: 'Choose at least one service day.' })
    }

    setBusy(true)
    try {
      const contract = await api<{ id: string }>('/api/contracts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId: data.client.id,
          name: `${data.client.displayName} service agreement`,
          status: 'active', startDate: serviceDraft.startDate, endDate: serviceDraft.endDate || null,
          currency: 'EUR', siteIds: [site.id], completionPolicy: { checklistRequired: true, blockOnOpenCriticalIncident: true },
        }),
      })
      const plan = await api<{ id: string }>('/api/service-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          contractId: contract.id,
          siteId: site.id,
          name: serviceDraft.serviceName,
          description: taskTitles.join('\n'),
          expectedDurationMinutes: Number(serviceDraft.durationMinutes),
          requiredWorkers: Number(serviceDraft.requiredWorkers),
          tasks: taskTitles.map((title, sortOrder) => ({ title, sortOrder, required: true, responseType: 'done_na_problem' })),
        }),
      })
      await api(`/api/service-plans/${plan.id}/publish`, { method: 'POST' })

      const startAt = localStart(serviceDraft.startDate, serviceDraft.time, site.timezone || 'Europe/Dublin')
      const recurrence = serviceDraft.frequency === 'once'
        ? { frequency: 'once' }
        : serviceDraft.frequency === 'daily'
          ? { frequency: 'daily', interval: 1 }
          : { frequency: 'weekly', interval: serviceDraft.frequency === 'fortnightly' ? 2 : 1, weekdays: serviceDraft.weekdays }

      await api('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          servicePlanId: plan.id,
          name: `${data.client.displayName} · ${site.name}`,
          startAt: startAt.toISOString(),
          endDate: serviceDraft.endDate || null,
          timezone: site.timezone || 'Europe/Dublin',
          durationMinutes: Number(serviceDraft.durationMinutes),
          requiredWorkers: Number(serviceDraft.requiredWorkers),
          instructions: taskTitles.join('\n'), recurrence, assigneeIds: [],
        }),
      })

      setServiceOpen(false)
      setNotice({ kind: 'success', text: 'Service activated. Future visits are now available in Schedule and can be staffed there.' })
      await refresh()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `${error instanceof Error ? error.message : 'Could not finish service setup.'} Any completed setup steps were kept so nothing is silently lost.`,
      })
      await refresh()
    } finally { setBusy(false) }
  }

  function toggleWeekday(day: number) {
    setServiceDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day) ? current.weekdays.filter((value) => value !== day) : [...current.weekdays, day],
    }))
  }

  if (loading && !data) return <main className="page-shell client-account-page"><div className="client-loading">Loading client account…</div></main>
  if (!data) return <main className="page-shell client-account-page"><div className="client-loading">Client account could not be loaded.</div></main>

  const client = data.client
  return <main className="page-shell client-account-page">
    <header className="client-account-hero">
      <div>
        <a href="/clients" className="client-back">← Clients</a>
        <span className="client-eyebrow">Client account</span>
        <div className="client-title-row"><h1>{client.displayName}</h1><span className={`client-state ${client.status}`}>{client.status}</span></div>
        <p>{client.type === 'residential' ? 'Residential cleaning account' : 'Commercial cleaning account'} · {client.sites.length} location{client.sites.length === 1 ? '' : 's'} · {activeServiceCount} active service{activeServiceCount === 1 ? '' : 's'}</p>
      </div>
      <div className="client-hero-actions">
        {canManageClients ? <button className="client-button-secondary" onClick={() => setEditOpen(true)}><OpsIcon name="user" />Edit profile</button> : null}
        {canManageClients ? <button className="client-button-secondary" onClick={() => setLocationOpen(true)}><OpsIcon name="field" />Add location</button> : null}
        {canConfigureService ? <button className="client-button" onClick={() => client.sites.length ? setServiceOpen(true) : setLocationOpen(true)}><OpsIcon name="calendar" />Set up service</button> : null}
      </div>
    </header>

    {notice ? <div className={`client-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

    <section className="client-account-metrics">
      <article><span>Locations</span><strong>{client.sites.length}</strong><small>Where your team delivers service</small></article>
      <article><span>Services</span><strong>{serviceCount}</strong><small>{activeServiceCount} currently active</small></article>
      <article><span>Upcoming</span><strong>{data.upcomingVisits.length}</strong><small>Next visits in the active horizon</small></article>
      <article><span>Contract</span><strong>{client.contracts.some((contract) => contract.status === 'active') ? 'Active' : 'Setup'}</strong><small>{client.contracts[0]?.endDate ? `Through ${formatDate(client.contracts[0].endDate)}` : 'No fixed end date'}</small></article>
    </section>

    <div className="client-account-grid">
      <section className="client-section client-profile-card">
        <div className="client-section-head"><div><span className="client-eyebrow">Profile</span><h2>Client details</h2></div></div>
        <div className="client-facts">
          <div><span>Primary contact</span><strong>{primaryContact?.name ?? 'Not set'}</strong><small>{primaryContact?.email ?? primaryContact?.phone ?? 'No contact detail'}</small></div>
          <div><span>Billing email</span><strong>{client.billingEmail || 'Not set'}</strong><small>{client.phone || 'No client phone'}</small></div>
        </div>
      </section>

      <section className="client-section client-locations-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Locations</span><h2>Where we clean</h2></div>{canManageClients ? <button className="client-text-button" onClick={() => setLocationOpen(true)}>Add location</button> : null}</div>
        <div className="client-location-list">
          {client.sites.map((site) => <article className="client-location-card" key={site.id}>
            <div className="client-location-icon"><OpsIcon name="field" /></div>
            <div className="client-location-copy"><strong>{site.name}</strong><span>{site.addressLine1}{site.addressLine2 ? `, ${site.addressLine2}` : ''}</span><small>{site.city} · {site.postalCode}</small>{site.access?.entryInstructions ? <p>{site.access.entryInstructions}</p> : null}</div>
            <div className="client-location-meta"><span>{site.servicePlans.length} service{site.servicePlans.length === 1 ? '' : 's'}</span><small>{site.preferredAssignees.length ? `${site.preferredAssignees.length} preferred cleaner${site.preferredAssignees.length === 1 ? '' : 's'}` : 'Team assigned in Schedule'}</small></div>
          </article>)}
          {!client.sites.length ? <div className="client-empty"><strong>No service location yet</strong><span>Add the address where cleaning will happen.</span>{canManageClients ? <button className="client-button" onClick={() => setLocationOpen(true)}>Add first location</button> : null}</div> : null}
        </div>
      </section>

      <section className="client-section client-services-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Service</span><h2>What we agreed to deliver</h2></div>{canConfigureService && client.sites.length ? <button className="client-text-button" onClick={() => setServiceOpen(true)}>Set up service</button> : null}</div>
        <div className="client-service-list">
          {client.sites.flatMap((site) => site.servicePlans.map((plan) => {
            const job = plan.jobs.find((item) => item.status === 'active') ?? plan.jobs[0]
            return <article className="client-service-card" key={plan.id}>
              <div className="client-service-top"><div><strong>{plan.name}</strong><span>{site.name}</span></div><span className={`client-state ${job?.status === 'active' ? 'active' : plan.status}`}>{job?.status === 'active' ? 'active' : plan.status}</span></div>
              <div className="client-service-summary">
                <div><span>Frequency</span><strong>{job ? recurrenceLabel(job.recurrence) : 'Not scheduled yet'}</strong></div>
                <div><span>Team size</span><strong>{plan.requiredWorkers} cleaner{plan.requiredWorkers === 1 ? '' : 's'}</strong></div>
                <div><span>Expected</span><strong>{durationLabel(plan.expectedDurationMinutes)}</strong></div>
                <div><span>Agreement</span><strong>{plan.contract?.endDate ? `to ${formatDate(plan.contract.endDate)}` : 'Ongoing'}</strong></div>
              </div>
              <div className="client-service-instructions"><span>Cleaning instructions</span>{plan.tasks.slice(0, 6).map((task) => <p key={task.id}>✓ {task.title}</p>)}{plan.tasks.length > 6 ? <small>+ {plan.tasks.length - 6} more tasks</small> : null}</div>
              <div className="client-service-foot"><span>{plan.versions[0] ? `Service version ${plan.versions[0].versionNumber}` : 'Draft service'} · {job ? `${job._count.visits} generated visits` : 'No visits generated'}</span></div>
            </article>
          }))}
          {!serviceCount ? <div className="client-empty"><strong>No cleaning service configured</strong><span>Define frequency, people required, duration and cleaning instructions in one setup.</span>{canConfigureService && client.sites.length ? <button className="client-button" onClick={() => setServiceOpen(true)}>Set up first service</button> : null}</div> : null}
        </div>
      </section>

      <section className="client-section client-schedule-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Schedule</span><h2>Upcoming work</h2></div></div>
        <div className="client-visit-list">
          {data.upcomingVisits.map((visit) => <article key={visit.id}><div><strong>{formatDateTime(visit.scheduledStart)}</strong><span>{visit.site.name}</span></div><div><span>{visit.assignments?.length ?? 0}/{visit.requiredWorkers ?? 0} cleaners</span><small>{visit.status.replaceAll('_', ' ')}</small></div></article>)}
          {!data.upcomingVisits.length ? <div className="client-empty compact"><strong>No upcoming visits</strong><span>Set up a service or schedule one-off work.</span></div> : null}
        </div>
      </section>

      <section className="client-section client-activity-section">
        <div className="client-section-head"><div><span className="client-eyebrow">Activity</span><h2>Recent completed work</h2></div></div>
        <div className="client-visit-list">
          {data.recentVisits.map((visit) => <article key={visit.id}><div><strong>{formatDateTime(visit.scheduledStart)}</strong><span>{visit.site.name}</span></div><span className="client-state active">completed</span></article>)}
          {!data.recentVisits.length ? <div className="client-empty compact"><strong>No completed visits yet</strong><span>Completed work will build the client history here.</span></div> : null}
        </div>
      </section>
    </div>

    <DetailDialog open={editOpen} title="Edit client profile" eyebrow="Client account" onClose={() => setEditOpen(false)}>
      <form className="client-dialog-form" onSubmit={saveProfile}>
        <label>Client name<input required value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} /></label>
        <label>Legal name <small>Optional</small><input value={profileDraft.legalName} onChange={(event) => setProfileDraft({ ...profileDraft, legalName: event.target.value })} /></label>
        <label>Client type<select value={profileDraft.type} onChange={(event) => setProfileDraft({ ...profileDraft, type: event.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="public_sector">Public sector</option><option value="internal">Internal</option></select></label>
        <div className="client-form-pair"><label>Billing email<input type="email" value={profileDraft.billingEmail} onChange={(event) => setProfileDraft({ ...profileDraft, billingEmail: event.target.value })} /></label><label>Phone<input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} /></label></div>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setEditOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>Save changes</button></div>
      </form>
    </DetailDialog>

    <DetailDialog open={locationOpen} title="Add service location" eyebrow="Where we clean" onClose={() => setLocationOpen(false)}>
      <form className="client-dialog-form" onSubmit={addLocation}>
        <label>Location name <small>{client.type === 'residential' ? 'Example: Home' : 'Example: Ranelagh Clinic'}</small><input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder={client.type === 'residential' ? 'Home' : 'Site name'} /></label>
        <label>Address<input required value={locationDraft.addressLine1} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine1: event.target.value })} /></label>
        <label>Address line 2 <small>Optional</small><input value={locationDraft.addressLine2} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine2: event.target.value })} /></label>
        <div className="client-form-pair"><label>City<input required value={locationDraft.city} onChange={(event) => setLocationDraft({ ...locationDraft, city: event.target.value })} /></label><label>Postcode<input required value={locationDraft.postalCode} onChange={(event) => setLocationDraft({ ...locationDraft, postalCode: event.target.value })} /></label></div>
        <label>Entry notes <small>Optional · door, reception, keys</small><textarea rows={3} value={locationDraft.entryInstructions} onChange={(event) => setLocationDraft({ ...locationDraft, entryInstructions: event.target.value })} /></label>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setLocationOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>Save location</button></div>
      </form>
    </DetailDialog>

    <DetailDialog open={serviceOpen} title="Set up cleaning service" eyebrow="Simple service setup" onClose={() => setServiceOpen(false)}>
      <form className="client-dialog-form service-setup-form" onSubmit={setupService}>
        <div className="client-setup-note"><OpsIcon name="check" /><div><strong>One setup, several records handled automatically</strong><span>We keep the contract, service version and recurring work linked behind the scenes.</span></div></div>
        <label>Location<select required value={serviceDraft.siteId} onChange={(event) => setServiceDraft({ ...serviceDraft, siteId: event.target.value })}>{client.sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.city}</option>)}</select></label>
        <label>Service name<input required value={serviceDraft.serviceName} onChange={(event) => setServiceDraft({ ...serviceDraft, serviceName: event.target.value })} /></label>
        <div className="client-form-pair"><label>Service starts<input required type="date" value={serviceDraft.startDate} onChange={(event) => setServiceDraft({ ...serviceDraft, startDate: event.target.value })} /></label><label>Contract ends <small>Optional</small><input type="date" min={serviceDraft.startDate} value={serviceDraft.endDate} onChange={(event) => setServiceDraft({ ...serviceDraft, endDate: event.target.value })} /></label></div>
        <div className="client-form-pair"><label>Frequency<select value={serviceDraft.frequency} onChange={(event) => setServiceDraft({ ...serviceDraft, frequency: event.target.value as Frequency })}><option value="weekly">Every week</option><option value="fortnightly">Every 2 weeks</option><option value="daily">Every day</option><option value="once">One-off</option></select></label><label>Preferred time<input required type="time" value={serviceDraft.time} onChange={(event) => setServiceDraft({ ...serviceDraft, time: event.target.value })} /></label></div>
        {(serviceDraft.frequency === 'weekly' || serviceDraft.frequency === 'fortnightly') ? <fieldset className="client-weekdays"><legend>Service days</legend><div>{WEEKDAYS.map((day) => <button type="button" key={day.value} className={serviceDraft.weekdays.includes(day.value) ? 'selected' : ''} onClick={() => toggleWeekday(day.value)}>{day.short}</button>)}</div></fieldset> : null}
        <div className="client-form-pair"><label>People required<input required type="number" min={1} max={100} value={serviceDraft.requiredWorkers} onChange={(event) => setServiceDraft({ ...serviceDraft, requiredWorkers: Number(event.target.value) })} /></label><label>Expected duration <span className="client-inline-duration">minutes</span><input required type="number" min={15} max={1440} step={15} value={serviceDraft.durationMinutes} onChange={(event) => setServiceDraft({ ...serviceDraft, durationMinutes: Number(event.target.value) })} /></label></div>
        <label>Cleaning instructions <small>One task per line. Keep this practical for the cleaner.</small><textarea required rows={7} value={serviceDraft.instructions} onChange={(event) => setServiceDraft({ ...serviceDraft, instructions: event.target.value })} /></label>
        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setServiceOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>{busy ? 'Setting up…' : 'Activate service'}</button></div>
      </form>
    </DetailDialog>
  </main>
}
