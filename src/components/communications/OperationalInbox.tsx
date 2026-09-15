'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import StandardSelect from '../ui/StandardSelect'
import OpsIcon from '../ui/OpsIcon'

type Person = { id: string; name?: string | null; email: string; role?: string }
type Site = { id: string; name: string; client: { displayName: string } }
type Receipt = { id: string; seenAt?: string | null; acknowledgedAt?: string | null; acknowledgement?: string | null; user: Person }
type Notice = {
  id: string
  type: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  title: string
  body: string
  requiresAcknowledgement: boolean
  publishedAt: string
  expiresAt?: string | null
  site?: Site | null
  visit?: { id: string; scheduledStart: string; status: string } | null
  createdBy: Person
  recipients: Receipt[]
}
type NoticeData = {
  items: Notice[]
  summary: Record<string, number>
  pagination?: { page: number; limit: number; total: number; totalPages: number }
}
type Template = { id: string; key: string; subject: string; body: string; updatedAt: string }
type Job = { id: string; kind: string; status: string; attempts: number; maxAttempts: number; lastError?: string | null; createdAt: string }
type QueueData = { items: Job[]; counts: Record<string, number>; latestFailure?: { kind: string; lastError: string; lastAttemptAt: string | null } | null }
type CommunicationsBootstrap = { mine: NoticeData; all: NoticeData | null; people: Person[]; sites: Site[]; canManage: boolean; operationalEmailOverrideActive: boolean }
type DeliveryDiagnostic = {
  status: 'running' | 'success' | 'failure'
  recipient?: string
  message?: string
  error?: string
  messageId?: string
  checks?: { smtpVerified: boolean; recipientAccepted: boolean }
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Request failed')
  return payload.data
}

function when(value: string) {
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function deliveryJobLabel(kind: string) {
  const labels: Record<string, string> = {
    operational_notice_push: 'Mobile notification',
    operational_email: 'Operational email',
    client_supply: 'Client supplies',
    supply_alert: 'Supply alert',
    profile_change_alert: 'Profile change alert',
  }
  return labels[kind] ?? kind.replaceAll('_', ' ')
}

function deliveryJobStatus(job: Job) {
  if (job.status === 'sent') return 'Sent'
  if (job.status === 'queued') return job.attempts > 0
    ? `Retry scheduled · attempt ${job.attempts} of ${job.maxAttempts}`
    : 'Waiting to send'
  if (job.status === 'failed') return `Retry scheduled · attempt ${job.attempts} of ${job.maxAttempts}`
  if (job.status === 'exhausted') return `Failed after ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}`
  return job.status.replaceAll('_', ' ')
}

const NOTICE_TYPES = [
  { value: 'schedule_change', label: 'Schedule change' },
  { value: 'site_instruction', label: 'Site instruction' },
  { value: 'incident', label: 'Incident' },
  { value: 'materials', label: 'Materials' },
  { value: 'quality', label: 'Quality' },
  { value: 'general', label: 'General' },
]
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const ROLE_LABELS: Record<string, string> = {
  employee: 'Cleaners',
  field_supervisor: 'Supervisors',
  scheduler: 'Schedulers',
  organization_admin: 'Admins',
  stock_controller: 'Stock controllers',
  quality_inspector: 'Quality inspectors',
  finance: 'Finance',
  viewer: 'Viewers',
}

export default function OperationalInbox({ canManage, canConfigure }: { canManage: boolean; canConfigure: boolean }) {
  const [tab, setTab] = useState<'inbox' | 'broadcast' | 'tracking' | 'delivery'>('inbox')
  const [mine, setMine] = useState<NoticeData>({ items: [], summary: {} })
  const [all, setAll] = useState<NoticeData>({ items: [], summary: {} })
  const [people, setPeople] = useState<Person[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [operationalEmailOverrideActive, setOperationalEmailOverrideActive] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipientRole, setRecipientRole] = useState('all')
  const [onlySelectedRecipients, setOnlySelectedRecipients] = useState(false)
  const [recipientExpanded, setRecipientExpanded] = useState(false)
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'awaiting' | 'critical'>('all')
  const [trackingQuery, setTrackingQuery] = useState('')
  const [trackingState, setTrackingState] = useState<'all' | 'awaiting' | 'complete' | 'informational'>('all')
  const [trackingPriority, setTrackingPriority] = useState<'all' | Notice['priority']>('all')
  const [trackingPage, setTrackingPage] = useState(1)
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null)
  const [draft, setDraft] = useState({ type: 'schedule_change', priority: 'high', title: '', body: '', siteId: '', requiresAcknowledgement: true, sendEmail: true })
  const [alerts, setAlerts] = useState({ supplyAlerts: '', feedbackAlerts: '', operationalAlerts: '' })
  const [queue, setQueue] = useState<QueueData>({ items: [], counts: {} })
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('')
  const [deliveryTest, setDeliveryTest] = useState<DeliveryDiagnostic | null>(null)
  const [acknowledgementNotes, setAcknowledgementNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'info'>('success')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const bootstrap = await api<CommunicationsBootstrap>('/api/communications/bootstrap')
      setMine(bootstrap.mine)
      setOperationalEmailOverrideActive(bootstrap.operationalEmailOverrideActive)
      if (canManage) {
        setPeople(bootstrap.people)
        setSites(bootstrap.sites)
        setSelectedUsers((current) => current.filter((id) => bootstrap.people.some((person) => person.id === id)))
      }
      if (canConfigure) {
        const [alertData, queueData, templateData] = await Promise.all([
          api<typeof alerts>('/api/settings'),
          api<QueueData>('/api/notifications'),
          api<Template[]>('/api/templates'),
        ])
        setAlerts(alertData)
        setQueue(queueData)
        setTemplates(templateData)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the operational inbox.')
    } finally {
      setBusy(false)
    }
  }, [canConfigure, canManage])

  const loadTracking = useCallback(async () => {
    if (!canManage) return
    setTrackingLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        scope: 'all',
        page: String(trackingPage),
        limit: '8',
        trackingState,
        priority: trackingPriority,
      })
      if (trackingQuery.trim()) params.set('q', trackingQuery.trim())
      const data = await api<NoticeData>(`/api/operational-notices?${params.toString()}`)
      setAll(data)
      if (data.pagination && trackingPage > data.pagination.totalPages) setTrackingPage(data.pagination.totalPages)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load acknowledgement tracking.')
    } finally {
      setTrackingLoading(false)
    }
  }, [canManage, trackingPage, trackingPriority, trackingQuery, trackingState])

  async function refreshPage() {
    await refresh()
    if (tab === 'tracking' && canManage) await loadTracking()
  }

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (tab !== 'tracking' || !canManage) return
    const timer = window.setTimeout(() => { void loadTracking() }, trackingQuery.trim() ? 220 : 0)
    return () => window.clearTimeout(timer)
  }, [canManage, loadTracking, tab, trackingQuery])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const unacknowledged = useMemo(
    () => mine.items.filter((item) => item.requiresAcknowledgement && !item.recipients[0]?.acknowledgedAt),
    [mine.items],
  )
  const recipientPeople = useMemo(() => {
    const needle = recipientQuery.trim().toLowerCase()
    return people.filter((person) => {
      if (recipientRole !== 'all' && person.role !== recipientRole) return false
      if (onlySelectedRecipients && !selectedUsers.includes(person.id)) return false
      return !needle || `${person.name ?? ''} ${person.email} ${ROLE_LABELS[person.role ?? ''] ?? person.role ?? ''}`.toLowerCase().includes(needle)
    })
  }, [onlySelectedRecipients, people, recipientQuery, recipientRole, selectedUsers])
  const recipientGroups = useMemo(() => {
    const roles = [...new Set(people.map((person) => person.role).filter((role): role is string => Boolean(role)))]
    return roles.map((role) => ({
      role,
      label: ROLE_LABELS[role] ?? role.replaceAll('_', ' '),
      ids: people.filter((person) => person.role === role).map((person) => person.id),
    }))
  }, [people])
  const filteredInboxItems = useMemo(() => mine.items.filter((item) => {
    const own = item.recipients[0]
    if (inboxFilter === 'unread') return !own?.seenAt
    if (inboxFilter === 'awaiting') return item.requiresAcknowledgement && !own?.acknowledgedAt
    if (inboxFilter === 'critical') return item.priority === 'critical'
    return true
  }), [inboxFilter, mine.items])
  const visibleRecipientPeople = recipientExpanded ? recipientPeople : recipientPeople.slice(0, 8)
  const publishBlocker = !draft.title.trim()
    ? 'Add a title before publishing.'
    : !draft.body.trim()
      ? 'Add a message before publishing.'
      : !selectedUsers.length
        ? 'Select at least one recipient.'
        : ''
  const selectedTemplate = templates.find((template) => template.key === selectedTemplateKey) ?? templates[0] ?? null
  const queuedJobs = queue.counts.queued ?? 0
  const failedJobs = (queue.counts.failed ?? 0) + (queue.counts.exhausted ?? 0)

  function toggleRecipientIds(ids: string[]) {
    if (!ids.length) return
    setSelectedUsers((current) => ids.every((id) => current.includes(id))
      ? current.filter((id) => !ids.includes(id))
      : Array.from(new Set([...current, ...ids])))
  }

  async function receipt(item: Notice, action: 'seen' | 'acknowledged') {
    const acknowledgement = action === 'acknowledged' ? acknowledgementNotes[item.id]?.trim() || null : null
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    try {
      await api(`/api/operational-notices/${item.id}/receipt`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, acknowledgement }),
      })
      setNotice(action === 'acknowledged' ? 'Notice acknowledged.' : 'Marked as read.')
      if (action === 'acknowledged') setAcknowledgementNotes((current) => ({ ...current, [item.id]: '' }))
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the notice.')
    } finally { setBusy(false) }
  }

  async function deleteNotice(item: Notice) {
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    try {
      await api(`/api/operational-notices/${item.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      setNotice('Notice deleted.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the notice.')
    } finally { setBusy(false) }
  }

  async function publish() {
    if (!draft.title.trim() || !draft.body.trim() || !selectedUsers.length) return
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    try {
      await api('/api/operational-notices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, siteId: draft.siteId || null, userIds: selectedUsers }),
      })
      setNotice(`Published to ${selectedUsers.length} team member${selectedUsers.length === 1 ? '' : 's'}${draft.sendEmail ? ' and queued for email delivery' : ''}.`)
      setDraft((current) => ({ ...current, title: '', body: '' }))
      setSelectedUsers([])
      await refresh()
      setTab('tracking')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish the notice.')
    } finally { setBusy(false) }
  }

  async function saveDelivery() {
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    try {
      await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alerts) })
      setNotice('Delivery recipients saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save recipients.')
    } finally { setBusy(false) }
  }

  async function testDelivery() {
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    setDeliveryTest({ status: 'running' })
    try {
      const response = await fetch('/api/notifications/test', { method: 'POST', credentials: 'include', cache: 'no-store' })
      const payload = await response.json().catch(() => null) as {
        data?: { message?: string; recipient?: string; messageId?: string; checks?: { smtpVerified: boolean; recipientAccepted: boolean } }
        error?: string
      } | null
      if (!response.ok) {
        setDeliveryTest({
          status: 'failure',
          recipient: payload?.data?.recipient,
          checks: payload?.data?.checks,
          messageId: payload?.data?.messageId,
          error: payload?.error ?? 'Email delivery test failed.',
        })
        return
      }
      setDeliveryTest({
        status: 'success',
        recipient: payload?.data?.recipient,
        message: payload?.data?.message,
        messageId: payload?.data?.messageId,
        checks: payload?.data?.checks,
      })
    } catch (cause) {
      setDeliveryTest({ status: 'failure', error: cause instanceof Error ? cause.message : 'Email delivery test failed.' })
    } finally { setBusy(false) }
  }

  async function processQueue() {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api<{ processed: number }>('/api/notifications/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 20 }),
      })
      if (result.processed === 0) {
        setNoticeTone('info')
        setNotice('No delivery jobs were due.')
      } else {
        setNoticeTone('success')
        setNotice(`${result.processed} delivery job${result.processed === 1 ? '' : 's'} processed successfully.`)
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not process delivery jobs.')
    } finally { setBusy(false) }
  }

  async function saveTemplate(template: Template) {
    setBusy(true); setError(''); setNoticeTone('success'); setNotice('')
    try {
      await api('/api/templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: template.key, subject: template.subject, body: template.body }),
      })
      setNotice('Template saved.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the template.')
    } finally { setBusy(false) }
  }

  const tabs = [
    ['inbox', unacknowledged.length ? `Inbox (${unacknowledged.length})` : 'Inbox'],
    ...(canManage ? [['broadcast', 'Broadcast'], ['tracking', 'Acknowledgements']] : []),
    ...(canConfigure ? [['delivery', 'Delivery settings']] : []),
  ] as Array<[typeof tab, string]>
  const tabIcons = { inbox: 'message', broadcast: 'user', tracking: 'review', delivery: 'activity' } as const

  return <main className="page-shell ops-inbox">
    <section className="inbox-hero">
      <div className="communications-hero-title"><span className="communications-icon-tile"><OpsIcon name="message" size={20} /></span><div><span className="eyebrow">Operational communication</span><h1>Team inbox</h1><p>Important changes stay connected to the site and produce proof that the right people saw them.</p></div></div>
      <button className="secondary communications-refresh" type="button" onClick={() => void refreshPage()} disabled={busy || trackingLoading}><OpsIcon name="refresh" size={16} /> Refresh</button>
    </section>
    {notice ? <div className={`transient-notice ${noticeTone}`} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div> : null}
    {error ? <div className="inline-message error" role="alert">{error}</div> : null}
    <nav className="materials-tabs" aria-label="Inbox views">
      {tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><OpsIcon name={tabIcons[key]} size={15} />{label}</button>)}
    </nav>

    {tab === 'inbox' ? <section className="inbox-layout">
      <div className="inbox-stream">
        {filteredInboxItems.map((item) => {
          const own = item.recipients[0]
          return <article className={`inbox-message ${item.priority} ${own?.seenAt ? 'seen' : ''}`} key={item.id}>
            <div className="inbox-message-head"><span className={`priority-label ${item.priority}`}>{item.priority}</span><span>{item.type.replaceAll('_', ' ')}</span><time>{when(item.publishedAt)}</time></div>
            <h2>{item.title}</h2><p>{item.body}</p>
            {item.site ? <div className="message-context"><strong>{item.site.client.displayName}</strong><span>{item.site.name}</span></div> : null}
            <small>From {item.createdBy.name ?? item.createdBy.email}</small>
            <div className="message-actions">
              {!own?.seenAt && !item.requiresAcknowledgement ? <button type="button" onClick={() => void receipt(item, 'seen')}>Mark read</button> : null}
              {item.requiresAcknowledgement && !own?.acknowledgedAt ? <>
                <label className="acknowledgement-note"><span>Optional note to the manager</span><input value={acknowledgementNotes[item.id] ?? ''} onChange={(event) => setAcknowledgementNotes((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} placeholder="Add context if needed" /></label>
                <button type="button" disabled={busy} onClick={() => void receipt(item, 'acknowledged')}>Acknowledge</button>
              </> : null}
              {own?.acknowledgedAt ? <span>✓ Acknowledged {when(own.acknowledgedAt)}</span> : null}
              {canManage ? <button type="button" className="danger-text-button" disabled={busy} onClick={() => setDeleteTarget(item)}>Delete</button> : null}
            </div>
          </article>
        })}
        {filteredInboxItems.length === 0 ? <div className="card empty-inbox"><strong>{mine.items.length ? 'Nothing in this filter.' : 'You are all caught up.'}</strong><span>{mine.items.length ? 'Choose another Inbox health filter to see more messages.' : 'No operational notices have been sent to you.'}</span></div> : null}
      </div>
      <aside className="card inbox-summary">
        <div className="inbox-summary-head"><div className="communications-section-title"><span className="communications-mini-icon"><OpsIcon name="activity" size={16} /></span><h2>Inbox health</h2></div>{inboxFilter !== 'all' ? <button type="button" className="text-button" onClick={() => setInboxFilter('all')}>Show all</button> : null}</div>
        <button type="button" className={inboxFilter === 'unread' ? 'active' : ''} aria-pressed={inboxFilter === 'unread'} onClick={() => setInboxFilter((current) => current === 'unread' ? 'all' : 'unread')}><OpsIcon name="message" size={17} /><strong>{mine.summary.unread ?? 0}</strong><span>Unread</span></button>
        <button type="button" className={inboxFilter === 'awaiting' ? 'active' : ''} aria-pressed={inboxFilter === 'awaiting'} onClick={() => setInboxFilter((current) => current === 'awaiting' ? 'all' : 'awaiting')}><OpsIcon name="check" size={17} /><strong>{mine.summary.awaitingAcknowledgement ?? 0}</strong><span>Awaiting acknowledgement</span></button>
        <button type="button" className={inboxFilter === 'critical' ? 'active' : ''} aria-pressed={inboxFilter === 'critical'} onClick={() => setInboxFilter((current) => current === 'critical' ? 'all' : 'critical')}><OpsIcon name="alert" size={17} /><strong>{mine.summary.critical ?? 0}</strong><span>Critical</span></button>
      </aside>
    </section> : null}

    {tab === 'broadcast' && canManage ? <section className="broadcast-layout"><article className="card broadcast-form">
      <div className="communications-section-heading"><span className="communications-icon-tile violet"><OpsIcon name="message" size={19} /></span><div><span className="eyebrow">Broadcast</span><h2>Publish operational notice</h2><p>Write once, target the right people and track acknowledgement.</p></div></div>
      <div className="admin-form-grid two-columns">
        <div className="inbox-select-field"><span>Type</span><StandardSelect value={draft.type} onChange={(value) => setDraft((current) => ({ ...current, type: value }))} ariaLabel="Notice type" options={NOTICE_TYPES} /></div>
        <div className="inbox-select-field"><span>Priority</span><StandardSelect value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value }))} ariaLabel="Notice priority" options={PRIORITIES} /></div>
        <div className="inbox-select-field"><span>Site context</span><StandardSelect searchable={sites.length > 8} value={draft.siteId} onChange={(value) => setDraft((current) => ({ ...current, siteId: value }))} ariaLabel="Site context" searchPlaceholder="Search client or site…" options={[{ value: '', label: 'Organization-wide' }, ...sites.map((site) => ({ value: site.id, label: `${site.client.displayName} · ${site.name}` }))]} /></div>
        <label className={draft.requiresAcknowledgement ? 'ack-toggle ack-toggle-card active' : 'ack-toggle ack-toggle-card'}><input type="checkbox" aria-label="Require acknowledgement" checked={draft.requiresAcknowledgement} onChange={(event) => setDraft((current) => ({ ...current, requiresAcknowledgement: event.target.checked }))} /><span><strong>{draft.requiresAcknowledgement ? 'Acknowledgement required' : 'Acknowledgement optional'}</strong><small>{draft.requiresAcknowledgement ? 'Recipients must confirm this notice.' : 'Recipients can read it without confirming.'}</small></span></label>
      </div>
      <fieldset className="broadcast-delivery"><legend>Delivery</legend><div className="broadcast-delivery-grid">
        <div className="broadcast-channel active"><span className="communications-mini-icon"><OpsIcon name="message" size={16} /></span><span><strong>Team inbox</strong><small>Always published in the web and mobile inbox with acknowledgement tracking.</small></span><b>Always on</b></div>
        <label className={draft.sendEmail ? 'broadcast-channel active' : 'broadcast-channel'}><input type="checkbox" aria-label="Also send by email" checked={draft.sendEmail} onChange={(event) => setDraft((current) => ({ ...current, sendEmail: event.target.checked }))} /><span><strong>Also send by email</strong><small>Queues a separate email to every selected recipient. Useful for urgent or important updates.</small></span><b>{draft.sendEmail ? 'On' : 'Off'}</b></label>
      </div>{operationalEmailOverrideActive && draft.sendEmail ? <p className="broadcast-delivery-warning"><OpsIcon name="alert" size={14} /> Email test override is active. Broadcast emails will be redirected to the test inbox until an administrator disables it in Delivery settings.</p> : <p>Phone push notifications are planned for a future release. Visit reminders already scheduled by the app are unchanged.</p>}</fieldset>
      <label><span>Title</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Tomorrow's start time changed" /></label>
      <label><span>Message</span><textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder="State what changed, what the team must do and who to contact…" /></label>
      <div className="recipient-picker">
        <div className="recipient-picker-head"><div><strong>Recipients</strong><span>{recipientPeople.length} shown · {selectedUsers.length} selected</span></div><div className="recipient-picker-actions"><button type="button" className="text-button" onClick={() => toggleRecipientIds(recipientPeople.map((person) => person.id))}>{recipientPeople.length > 0 && recipientPeople.every((person) => selectedUsers.includes(person.id)) ? 'Clear shown' : 'Select shown'}</button>{selectedUsers.length ? <button type="button" className="text-button muted" onClick={() => setSelectedUsers([])}>Clear selection</button> : null}</div></div>
        <div className="recipient-filter-bar">
          <label className="recipient-search"><span className="sr-only">Search recipients</span><input type="search" value={recipientQuery} onChange={(event) => { setRecipientQuery(event.target.value); setRecipientExpanded(false) }} placeholder="Search name, email or role…" /></label>
          <button type="button" className={onlySelectedRecipients ? 'recipient-filter-toggle active' : 'recipient-filter-toggle'} aria-pressed={onlySelectedRecipients} onClick={() => { setOnlySelectedRecipients((current) => !current); setRecipientExpanded(false) }}>Selected only <b>{selectedUsers.length}</b></button>
        </div>
        <div className="recipient-groups" role="group" aria-label="Filter recipients by role">
          <button type="button" className={recipientRole === 'all' ? 'selected' : ''} aria-pressed={recipientRole === 'all'} onClick={() => { setRecipientRole('all'); setRecipientExpanded(false) }}>Everyone <b>{people.length}</b></button>
          {recipientGroups.map((group) => <button type="button" key={group.role} className={recipientRole === group.role ? 'selected' : ''} aria-pressed={recipientRole === group.role} onClick={() => { setRecipientRole(group.role); setRecipientExpanded(false) }}>{group.label} <b>{group.ids.length}</b></button>)}
        </div>
        <div className="recipient-list">
          {visibleRecipientPeople.map((person) => <label className={selectedUsers.includes(person.id) ? 'selected' : ''} key={person.id}><input type="checkbox" checked={selectedUsers.includes(person.id)} onChange={() => toggleRecipientIds([person.id])} /><span><strong>{person.name ?? person.email}</strong><small>{ROLE_LABELS[person.role ?? ''] ?? person.role?.replaceAll('_', ' ') ?? 'Team member'} · {person.email}</small></span></label>)}
          {recipientPeople.length === 0 ? <div className="recipient-empty">No team members match these filters.</div> : null}
        </div>
        {recipientPeople.length > 8 ? <button type="button" className="recipient-expand" onClick={() => setRecipientExpanded((current) => !current)}>{recipientExpanded ? 'Show less' : `Show all ${recipientPeople.length} recipients`}</button> : null}
      </div>
      <div className={publishBlocker ? "publish-readiness" : "publish-readiness ready"}><span aria-hidden="true">{publishBlocker ? '○' : '✓'}</span><p>{publishBlocker || `Ready for ${selectedUsers.length} team member${selectedUsers.length === 1 ? '' : 's'} via Team inbox${draft.sendEmail ? ' and email' : ''}.`}</p></div>
      <button type="button" className={publishBlocker ? 'publish-action' : 'publish-action ready'} onClick={() => void publish()} disabled={busy || Boolean(publishBlocker)}>{publishBlocker ? 'Complete the required fields' : `Publish to ${selectedUsers.length} recipient${selectedUsers.length === 1 ? '' : 's'}`}</button>
    </article></section> : null}

    {tab === 'tracking' && canManage ? <section className="tracking-workspace">
      <div className="communications-section-heading tracking-heading"><span className="communications-icon-tile violet"><OpsIcon name="review" size={19} /></span><div><span className="eyebrow">Acknowledgement control</span><h2>Track communication at scale</h2><p>Filter the notices that still need action instead of scanning every message ever published.</p></div></div>

      <section className="tracking-overview" aria-label="Acknowledgement summary">
        <button type="button" className={trackingState === 'all' && trackingPriority === 'all' ? 'active' : ''} onClick={() => { setTrackingState('all'); setTrackingPriority('all'); setTrackingPage(1) }}><OpsIcon name="message" size={18} /><span>Published</span><strong>{all.summary.total ?? 0}</strong><small>All notices</small></button>
        <button type="button" className={trackingState === 'awaiting' ? 'active attention' : 'attention'} onClick={() => { setTrackingState('awaiting'); setTrackingPriority('all'); setTrackingPage(1) }}><OpsIcon name="clock" size={18} /><span>Awaiting</span><strong>{all.summary.awaiting ?? 0}</strong><small>Need acknowledgement</small></button>
        <button type="button" className={trackingState === 'complete' ? 'active complete' : 'complete'} onClick={() => { setTrackingState('complete'); setTrackingPriority('all'); setTrackingPage(1) }}><OpsIcon name="check" size={18} /><span>Complete</span><strong>{all.summary.complete ?? 0}</strong><small>Fully acknowledged</small></button>
        <button type="button" className={trackingPriority === 'critical' ? 'active critical' : 'critical'} onClick={() => { setTrackingState('all'); setTrackingPriority('critical'); setTrackingPage(1) }}><OpsIcon name="alert" size={18} /><span>Critical</span><strong>{all.summary.critical ?? 0}</strong><small>Highest priority</small></button>
      </section>

      <div className="card tracking-toolbar">
        <label className="tracking-search"><OpsIcon name="search" size={17} /><span className="sr-only">Search acknowledgement notices</span><input type="search" value={trackingQuery} onChange={(event) => { setTrackingQuery(event.target.value); setTrackingPage(1) }} placeholder="Search title or message…" /></label>
        <div className="inbox-select-field"><span>Status</span><StandardSelect value={trackingState} onChange={(value) => { setTrackingState(value as typeof trackingState); setTrackingPage(1) }} ariaLabel="Acknowledgement status" options={[
          { value: 'all', label: 'All statuses' },
          { value: 'awaiting', label: 'Awaiting acknowledgement' },
          { value: 'complete', label: 'Fully acknowledged' },
          { value: 'informational', label: 'No acknowledgement required' },
        ]} /></div>
        <div className="inbox-select-field"><span>Priority</span><StandardSelect value={trackingPriority} onChange={(value) => { setTrackingPriority(value as typeof trackingPriority); setTrackingPage(1) }} ariaLabel="Tracking priority" options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES]} /></div>
        <div className="tracking-result-count"><strong>{all.pagination?.total ?? 0}</strong><span>matching notice{(all.pagination?.total ?? 0) === 1 ? '' : 's'}</span></div>
      </div>

      {trackingLoading ? <div className="card tracking-loading"><span className="delivery-test-spinner" /><span>Loading acknowledgement control…</span></div> : <div className="tracking-grid">
        {all.items.map((item) => {
          const seen = item.recipients.filter((receipt) => receipt.seenAt).length
          const ack = item.recipients.filter((receipt) => receipt.acknowledgedAt).length
          const pending = Math.max(0, item.recipients.length - ack)
          const complete = item.requiresAcknowledgement && item.recipients.length > 0 && pending === 0
          return <article className="card tracking-card" key={item.id}>
            <div className="tracking-card-head"><div className="inbox-message-head"><span className={`priority-label ${item.priority}`}>{item.priority}</span><span>{item.type.replaceAll('_', ' ')}</span></div><time>{when(item.publishedAt)}</time></div>
            <div className="tracking-card-copy"><h2>{item.title}</h2><p>{item.body}</p>{item.site ? <small><OpsIcon name="field" size={14} /> {item.site.client.displayName} · {item.site.name}</small> : <small><OpsIcon name="message" size={14} /> Organization-wide</small>}</div>
            <div className="tracking-status-row">
              <span className={`tracking-status-chip ${!item.requiresAcknowledgement ? 'informational' : complete ? 'complete' : 'awaiting'}`}><OpsIcon name={!item.requiresAcknowledgement ? 'message' : complete ? 'check' : 'clock'} size={14} />{!item.requiresAcknowledgement ? 'No acknowledgement required' : complete ? 'Fully acknowledged' : `${pending} awaiting`}</span>
              <span>{seen}/{item.recipients.length} seen</span>
            </div>
            {item.requiresAcknowledgement ? <><div className="ack-progress" aria-label={`${ack} of ${item.recipients.length} acknowledged`}><div style={{ width: `${item.recipients.length ? (ack / item.recipients.length) * 100 : 0}%` }} /></div><div className="tracking-progress-copy"><strong>{ack}/{item.recipients.length} acknowledged</strong><span>{item.recipients.length ? Math.round((ack / item.recipients.length) * 100) : 0}%</span></div></> : null}
            <details className="tracking-recipients"><summary><span><OpsIcon name="user" size={15} /> Recipient status</span><b>{item.recipients.length}</b></summary><div className="tracking-receipt-list">{item.recipients.map((receipt) => <div className="receipt-row" key={receipt.id}><span><strong>{receipt.user.name ?? receipt.user.email}</strong><small>{receipt.user.email}</small></span><span className={receipt.acknowledgedAt ? 'acknowledged' : receipt.seenAt ? 'seen' : 'delivered'}>{receipt.acknowledgedAt ? 'Acknowledged' : receipt.seenAt ? 'Seen' : 'Delivered'}</span></div>)}</div></details>
          </article>
        })}
        {!all.items.length ? <div className="card tracking-empty"><OpsIcon name="search" size={22} /><strong>No notices match these filters.</strong><span>Clear or change the filters to broaden acknowledgement tracking.</span></div> : null}
      </div>}

      {(all.pagination?.totalPages ?? 1) > 1 ? <nav className="tracking-pagination" aria-label="Acknowledgement pages"><span>Showing {((all.pagination?.page ?? 1) - 1) * (all.pagination?.limit ?? 8) + 1}–{Math.min((all.pagination?.page ?? 1) * (all.pagination?.limit ?? 8), all.pagination?.total ?? 0)} of {all.pagination?.total ?? 0}</span><div><button type="button" className="secondary" disabled={trackingLoading || (all.pagination?.page ?? 1) <= 1} onClick={() => setTrackingPage((page) => Math.max(1, page - 1))}>← Previous</button><strong>Page {all.pagination?.page ?? 1} of {all.pagination?.totalPages ?? 1}</strong><button type="button" className="secondary" disabled={trackingLoading || (all.pagination?.page ?? 1) >= (all.pagination?.totalPages ?? 1)} onClick={() => setTrackingPage((page) => Math.min(all.pagination?.totalPages ?? page, page + 1))}>Next →</button></div></nav> : null}
    </section> : null}

    {tab === 'delivery' && canConfigure ? <section className="delivery-stack">
      <section className="delivery-overview-grid" aria-label="Delivery status">
        <article className="card delivery-overview-card">
          <span className="communications-icon-tile"><OpsIcon name="message" size={18} /></span>
          <div><span>Routing</span><strong>{alerts.operationalAlerts.trim() ? 'Test override active' : 'Real event recipients'}</strong><small>{alerts.operationalAlerts.trim() || 'Operational events use their workflow recipients.'}</small></div>
        </article>
        <button type="button" className="card delivery-overview-card interactive" onClick={() => void testDelivery()} disabled={busy}>
          <span className="communications-icon-tile violet"><OpsIcon name="check" size={18} /></span>
          <div><span>Email diagnostic</span><strong>Send test email</strong><small>Sends directly to the configured test inbox. It does not enter the delivery queue.</small></div><OpsIcon name="review" size={18} />
        </button>
        <article className={`card delivery-overview-card ${failedJobs ? 'attention' : ''}`}>
          <span className={`communications-icon-tile ${failedJobs ? 'danger' : ''}`}><OpsIcon name={failedJobs ? 'alert' : 'activity'} size={18} /></span>
          <div><span>Delivery queue</span><strong>{failedJobs ? `${failedJobs} need attention` : queuedJobs ? `${queuedJobs} queued` : 'Queue healthy'}</strong><small>{queue.counts.sent ?? 0} sent · {queue.counts.failed ?? 0} failed · {queue.counts.exhausted ?? 0} exhausted</small></div>
        </article>
      </section>

      <article className="card delivery-settings-card">
        <div className="communications-section-heading"><span className="communications-icon-tile"><OpsIcon name="user" size={19} /></span><div><span className="eyebrow">Routing</span><h2>Email escalation recipients</h2><p>Keep normal workflow recipients untouched and use a test override only when you are validating delivery.</p></div></div>
        <div className="admin-form-grid two-columns delivery-recipient-grid">
          <label><span>Supply alerts</span><input value={alerts.supplyAlerts} onChange={(event) => setAlerts((current) => ({ ...current, supplyAlerts: event.target.value }))} /></label>
          <label><span>Quality alerts</span><input value={alerts.feedbackAlerts} onChange={(event) => setAlerts((current) => ({ ...current, feedbackAlerts: event.target.value }))} /></label>
          <label className="delivery-override-field"><span>Operational emails · test override</span><input value={alerts.operationalAlerts} onChange={(event) => setAlerts((current) => ({ ...current, operationalAlerts: event.target.value }))} placeholder="Leave blank to use real event recipients" /><small>{alerts.operationalAlerts.trim() ? 'Test mode: operational email is redirected here.' : 'Live routing: each workflow chooses its real recipient.'}</small></label>
        </div>
        <div className="delivery-settings-actions"><span><OpsIcon name={alerts.operationalAlerts.trim() ? 'alert' : 'check'} size={16} />{alerts.operationalAlerts.trim() ? 'A delivery override is active.' : 'No test override is active.'}</span><button type="button" onClick={() => void saveDelivery()} disabled={busy}>Save recipients</button></div>
      </article>

      <article className="card delivery-queue-card">
        <div className="section-heading"><div className="communications-section-title"><span className="communications-icon-tile soft"><OpsIcon name="activity" size={19} /></span><div><span className="eyebrow">Background delivery</span><h2>Email deliveries</h2><p>Workflow-generated emails and Broadcast email escalations. The Team inbox itself is delivered immediately.</p></div></div><button type="button" className="secondary" onClick={() => void processQueue()} disabled={busy}><OpsIcon name="refresh" size={16} /> Process due</button></div>
        <div className="delivery-queue-metrics"><span><b>{queue.counts.queued ?? 0}</b><small>Queued</small></span><span><b>{queue.counts.failed ?? 0}</b><small>Failed</small></span><span><b>{queue.counts.exhausted ?? 0}</b><small>Exhausted</small></span><span><b>{queue.counts.sent ?? 0}</b><small>Sent</small></span></div>
        {queue.latestFailure ? <div className="delivery-latest-failure" role="status"><OpsIcon name="alert" size={17} /><div><strong>Latest failure</strong><span>{queue.latestFailure.kind.replaceAll('_', ' ')} — {queue.latestFailure.lastError}{queue.latestFailure.lastAttemptAt ? ` · ${when(queue.latestFailure.lastAttemptAt)}` : ''}</span></div></div> : null}
        <div className="delivery-jobs">{queue.items.slice(0, 12).map((job) => <div key={job.id}><strong>{deliveryJobLabel(job.kind)}</strong><span className={`delivery-job-status ${job.status}`}>{deliveryJobStatus(job)}</span>{job.lastError ? <small>{job.lastError}</small> : null}</div>)}</div>
        {!queue.items.length ? <div className="delivery-empty"><OpsIcon name="check" size={19} /><span>No recent delivery jobs need inspection.</span></div> : null}
      </article>

      <section className="card template-workspace">
        <div className="communications-section-heading"><span className="communications-icon-tile violet"><OpsIcon name="spreadsheet" size={19} /></span><div><span className="eyebrow">Reusable content</span><h2>Email templates</h2><p>Select one template to edit. The rest stay out of the way until you need them.</p></div></div>
        {templates.length ? <>
          <div className="template-toolbar">
            <div className="inbox-select-field"><span>Template</span><StandardSelect searchable={templates.length > 5} value={selectedTemplate?.key ?? ''} onChange={setSelectedTemplateKey} ariaLabel="Email template" searchPlaceholder="Search templates…" options={templates.map((template) => ({ value: template.key, label: template.key.replaceAll('_', ' ') }))} /></div>
            {selectedTemplate ? <div className="template-meta"><OpsIcon name="clock" size={15} /><span>Last updated {when(selectedTemplate.updatedAt)}</span></div> : null}
          </div>
          {selectedTemplate ? <article className="template-editor">
            <div className="template-editor-head"><div><span className="template-key">{selectedTemplate.key.replaceAll('_', ' ')}</span><strong>{selectedTemplate.subject || 'Untitled template'}</strong></div><span className="template-status"><OpsIcon name="check" size={14} /> Active template</span></div>
            <label><span>Subject</span><input value={selectedTemplate.subject} onChange={(event) => setTemplates((current) => current.map((item) => item.id === selectedTemplate.id ? { ...item, subject: event.target.value } : item))} /></label>
            <label><span>HTML body</span><textarea value={selectedTemplate.body} onChange={(event) => setTemplates((current) => current.map((item) => item.id === selectedTemplate.id ? { ...item, body: event.target.value } : item))} /></label>
            <div className="template-editor-actions"><button type="button" disabled={busy} onClick={() => void saveTemplate(selectedTemplate)}><OpsIcon name="check" size={16} /> Save template</button></div>
          </article> : null}
        </> : <div className="delivery-empty"><OpsIcon name="spreadsheet" size={19} /><span>No email templates are configured.</span></div>}
      </section>
    </section> : null}
    {deliveryTest ? <div className="ops-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && deliveryTest.status !== 'running') setDeliveryTest(null) }}><section className="card delivery-test-dialog" role="dialog" aria-modal="true" aria-labelledby="delivery-test-title">
      <div className="delivery-test-head"><span className={`communications-icon-tile ${deliveryTest.status === 'failure' ? 'danger' : deliveryTest.status === 'success' ? '' : 'violet'}`}><OpsIcon name={deliveryTest.status === 'failure' ? 'alert' : deliveryTest.status === 'success' ? 'check' : 'activity'} size={21} /></span><div><span className="eyebrow">Email diagnostic</span><h2 id="delivery-test-title">{deliveryTest.status === 'running' ? 'Testing delivery…' : deliveryTest.status === 'success' ? 'Email accepted for delivery' : 'Delivery test needs attention'}</h2></div></div>
      {deliveryTest.status === 'running' ? <div className="delivery-test-running"><span className="delivery-test-spinner" /><p>Checking SMTP connection and sending one controlled test email.</p></div> : <>
        <div className="delivery-test-checks">
          <div className={deliveryTest.checks?.smtpVerified ? 'pass' : 'fail'}><span><OpsIcon name={deliveryTest.checks?.smtpVerified ? 'check' : 'alert'} size={17} /></span><div><strong>SMTP connection</strong><small>{deliveryTest.checks?.smtpVerified ? 'Verified successfully' : 'Could not verify'}</small></div></div>
          <div className={deliveryTest.checks?.recipientAccepted ? 'pass' : 'fail'}><span><OpsIcon name={deliveryTest.checks?.recipientAccepted ? 'check' : 'alert'} size={17} /></span><div><strong>Recipient acceptance</strong><small>{deliveryTest.checks?.recipientAccepted ? 'Accepted by the mail server' : 'Not accepted by the mail server'}</small></div></div>
          <div className="manual"><span><OpsIcon name="review" size={17} /></span><div><strong>Inbox arrival</strong><small>Not confirmed automatically — check inbox and spam</small></div></div>
        </div>
        <div className="delivery-test-meta">
          {deliveryTest.recipient ? <div className="delivery-test-recipient"><span>Test recipient</span><strong>{deliveryTest.recipient}</strong></div> : null}
          {deliveryTest.messageId ? <div className="delivery-test-recipient"><span>Message ID</span><strong title={deliveryTest.messageId}>{deliveryTest.messageId}</strong></div> : null}
        </div>
        <p className={deliveryTest.status === 'failure' ? 'delivery-test-message error' : 'delivery-test-message'}>{deliveryTest.error || deliveryTest.message || 'Diagnostic completed.'}</p>
        {deliveryTest.status === 'success' ? <p className="delivery-test-caveat"><OpsIcon name="review" size={15} /> SMTP acceptance means the sending server accepted the message. It does not prove Gmail placed it in the inbox.</p> : null}
        <div className="ops-confirm-actions"><button type="button" className="secondary" onClick={() => setDeliveryTest(null)}>Close</button><button type="button" disabled={busy} onClick={() => void testDelivery()}><OpsIcon name="refresh" size={16} /> Run again</button></div>
      </>}
    </section></div> : null}
    {deleteTarget ? <div className="ops-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setDeleteTarget(null) }}><section className="card ops-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-notice-title"><span className="eyebrow danger">Delete notice</span><h2 id="delete-notice-title">Delete “{deleteTarget.title}”?</h2><p>This removes the notice from every recipient and acknowledgement tracking. This action cannot be undone.</p><div className="ops-confirm-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="danger-action" disabled={busy} onClick={() => void deleteNotice(deleteTarget)}>Delete notice</button></div></section></div> : null}
  </main>
}
