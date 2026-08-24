'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Person = { id: string; name?: string | null; email: string }
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
type NoticeData = { items: Notice[]; summary: Record<string, number> }
type Template = { id: string; key: string; subject: string; body: string; updatedAt: string }
type Job = { id: string; kind: string; status: string; attempts: number; maxAttempts: number; lastError?: string | null; createdAt: string }
type QueueData = { items: Job[]; counts: Record<string, number> }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null
  if (!response.ok || !payload?.data) throw new Error(payload?.error ?? 'Request failed')
  return payload.data
}

function when(value: string) {
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function OperationalInbox({ canManage, canConfigure }: { canManage: boolean; canConfigure: boolean }) {
  const [tab, setTab] = useState<'inbox' | 'broadcast' | 'tracking' | 'delivery'>('inbox')
  const [mine, setMine] = useState<NoticeData>({ items: [], summary: {} })
  const [all, setAll] = useState<NoticeData>({ items: [], summary: {} })
  const [people, setPeople] = useState<Person[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [draft, setDraft] = useState({ type: 'schedule_change', priority: 'high', title: '', body: '', siteId: '', requiresAcknowledgement: true })
  const [alerts, setAlerts] = useState({ supplyAlerts: '', feedbackAlerts: '' })
  const [queue, setQueue] = useState<QueueData>({ items: [], counts: {} })
  const [templates, setTemplates] = useState<Template[]>([])
  const [acknowledgementNotes, setAcknowledgementNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const ownData = await api<NoticeData>('/api/operational-notices?scope=mine')
      setMine(ownData)
      if (canManage) {
        const [allData, employeeData, siteData] = await Promise.all([
          api<NoticeData>('/api/operational-notices?scope=all'),
          api<Person[]>('/api/employees'),
          api<Site[]>('/api/sites'),
        ])
        setAll(allData); setPeople(employeeData); setSites(siteData)
        setSelectedUsers((current) => current.filter((id) => employeeData.some((person) => person.id === id)))
      }
      if (canConfigure) {
        const [alertData, queueData, templateData] = await Promise.all([
          api<typeof alerts>('/api/settings'),
          api<QueueData>('/api/notifications'),
          api<Template[]>('/api/templates'),
        ])
        setAlerts(alertData); setQueue(queueData); setTemplates(templateData)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the operational inbox.')
    } finally { setBusy(false) }
  }, [canConfigure, canManage])

  useEffect(() => { void refresh() }, [refresh])

  const unacknowledged = useMemo(() => mine.items.filter((item) => item.requiresAcknowledgement && !item.recipients[0]?.acknowledgedAt), [mine.items])

  async function receipt(item: Notice, action: 'seen' | 'acknowledged') {
    const acknowledgement = action === 'acknowledged' ? acknowledgementNotes[item.id]?.trim() || null : null
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`/api/operational-notices/${item.id}/receipt`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, acknowledgement: acknowledgement?.trim() || null }),
      })
      setNotice(action === 'acknowledged' ? 'Notice acknowledged.' : 'Marked as read.')
      if (action === 'acknowledged') setAcknowledgementNotes((current) => ({ ...current, [item.id]: '' }))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the notice.') }
    finally { setBusy(false) }
  }

  async function publish() {
    if (!draft.title.trim() || !draft.body.trim() || !selectedUsers.length) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/operational-notices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, siteId: draft.siteId || null, userIds: selectedUsers }),
      })
      setNotice(`Published to ${selectedUsers.length} team member${selectedUsers.length === 1 ? '' : 's'}.`)
      setDraft((current) => ({ ...current, title: '', body: '' })); setSelectedUsers([])
      await refresh(); setTab('tracking')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish the notice.') }
    finally { setBusy(false) }
  }

  async function saveDelivery() {
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alerts) })
      setNotice('Delivery recipients saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save recipients.') }
    finally { setBusy(false) }
  }

  async function processQueue() {
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await api<{ processed: number }>('/api/notifications/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 20 }) })
      setNotice(`${data.processed} delivery job${data.processed === 1 ? '' : 's'} processed.`); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not process delivery jobs.') }
    finally { setBusy(false) }
  }

  async function saveTemplate(template: Template) {
    setBusy(true); setError(''); setNotice('')
    try {
      await api('/api/templates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: template.key, subject: template.subject, body: template.body }) })
      setNotice('Template saved.'); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the template.') }
    finally { setBusy(false) }
  }

  const tabs = [
    ['inbox', unacknowledged.length ? `Inbox (${unacknowledged.length})` : 'Inbox'],
    ...(canManage ? [['broadcast', 'Broadcast'], ['tracking', 'Acknowledgements']] : []),
    ...(canConfigure ? [['delivery', 'Delivery settings']] : []),
  ] as Array<[typeof tab, string]>

  return <main className="page-shell ops-inbox">
    <section className="inbox-hero"><div><span className="eyebrow">Operational communication</span><h1>Team inbox</h1><p>Important changes stay connected to the site and produce proof that the right people saw them.</p></div><button className="secondary" type="button" onClick={() => void refresh()} disabled={busy}>↻ Refresh</button></section>
    {notice ? <div className="inline-message success" role="status">{notice}</div> : null}{error ? <div className="inline-message error" role="alert">{error}</div> : null}
    <nav className="materials-tabs" aria-label="Inbox views">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>

    {tab === 'inbox' ? <section className="inbox-layout"><div className="inbox-stream">
      {mine.items.map((item) => { const own = item.recipients[0]; return <article className={`inbox-message ${item.priority} ${own?.seenAt ? 'seen' : ''}`} key={item.id}>
        <div className="inbox-message-head"><span className={`priority-label ${item.priority}`}>{item.priority}</span><span>{item.type.replaceAll('_', ' ')}</span><time>{when(item.publishedAt)}</time></div>
        <h2>{item.title}</h2><p>{item.body}</p>
        {item.site ? <div className="message-context"><strong>{item.site.client.displayName}</strong><span>{item.site.name}</span></div> : null}
        <small>From {item.createdBy.name ?? item.createdBy.email}</small>
        <div className="message-actions">{!own?.seenAt && !item.requiresAcknowledgement ? <button type="button" onClick={() => void receipt(item, 'seen')}>Mark read</button> : null}{item.requiresAcknowledgement && !own?.acknowledgedAt ? <><label className="acknowledgement-note"><span>Optional note to the manager</span><input value={acknowledgementNotes[item.id] ?? ''} onChange={(event) => setAcknowledgementNotes((current) => ({ ...current, [item.id]: event.target.value }))} maxLength={2000} placeholder="Add context if needed" /></label><button type="button" disabled={busy} onClick={() => void receipt(item, 'acknowledged')}>Acknowledge</button></> : null}{own?.acknowledgedAt ? <span>✓ Acknowledged {when(own.acknowledgedAt)}</span> : null}</div>
      </article>})}{mine.items.length === 0 ? <div className="card empty-inbox"><strong>You are all caught up.</strong><span>No operational notices have been sent to you.</span></div> : null}
    </div><aside className="card inbox-summary"><h2>Inbox health</h2><div><strong>{mine.summary.unread ?? 0}</strong><span>Unread</span></div><div><strong>{mine.summary.awaitingAcknowledgement ?? 0}</strong><span>Awaiting acknowledgement</span></div><div><strong>{mine.summary.critical ?? 0}</strong><span>Critical</span></div></aside></section> : null}

    {tab === 'broadcast' && canManage ? <section className="broadcast-layout"><article className="card broadcast-form"><h2>Publish operational notice</h2><div className="admin-form-grid two-columns">
      <label><span>Type</span><select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option value="schedule_change">Schedule change</option><option value="site_instruction">Site instruction</option><option value="incident">Incident</option><option value="materials">Materials</option><option value="quality">Quality</option><option value="general">General</option></select></label>
      <label><span>Priority</span><select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      <label><span>Site context</span><select value={draft.siteId} onChange={(event) => setDraft((current) => ({ ...current, siteId: event.target.value }))}><option value="">Organization-wide</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.client.displayName} · {site.name}</option>)}</select></label>
      <label className="ack-toggle"><input type="checkbox" checked={draft.requiresAcknowledgement} onChange={(event) => setDraft((current) => ({ ...current, requiresAcknowledgement: event.target.checked }))} /> Require acknowledgement</label>
    </div><label><span>Title</span><input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Tomorrow's start time changed" /></label><label><span>Message</span><textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder="State what changed, what the team must do and who to contact…" /></label>
    <div className="recipient-picker"><div><strong>Recipients</strong><button type="button" className="text-button" onClick={() => setSelectedUsers(selectedUsers.length === people.length ? [] : people.map((person) => person.id))}>{selectedUsers.length === people.length ? 'Clear' : 'Select all'}</button></div>{people.map((person) => <label key={person.id}><input type="checkbox" checked={selectedUsers.includes(person.id)} onChange={() => setSelectedUsers((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span><strong>{person.name ?? person.email}</strong><small>{person.email}</small></span></label>)}</div>
    <button type="button" onClick={() => void publish()} disabled={busy || !draft.title.trim() || !draft.body.trim() || !selectedUsers.length}>Publish & track acknowledgement</button></article></section> : null}

    {tab === 'tracking' && canManage ? <section className="tracking-grid">{all.items.map((item) => { const seen = item.recipients.filter((receipt) => receipt.seenAt).length; const ack = item.recipients.filter((receipt) => receipt.acknowledgedAt).length; return <article className="card tracking-card" key={item.id}><div className="inbox-message-head"><span className={`priority-label ${item.priority}`}>{item.priority}</span><time>{when(item.publishedAt)}</time></div><h2>{item.title}</h2><p>{item.body}</p><div className="ack-progress"><div style={{ width: `${item.recipients.length ? (ack / item.recipients.length) * 100 : 0}%` }} /></div><strong>{ack}/{item.recipients.length} acknowledged · {seen}/{item.recipients.length} seen</strong><details><summary>Recipient status</summary>{item.recipients.map((receipt) => <div className="receipt-row" key={receipt.id}><span>{receipt.user.name ?? receipt.user.email}</span><span>{receipt.acknowledgedAt ? 'Acknowledged' : receipt.seenAt ? 'Seen' : 'Delivered'}</span></div>)}</details></article>})}{all.items.length === 0 ? <p className="empty-copy">No notices published yet.</p> : null}</section> : null}

    {tab === 'delivery' && canConfigure ? <section className="delivery-stack"><article className="card"><h2>Email escalation recipients</h2><div className="admin-form-grid two-columns"><label><span>Supply alerts</span><input value={alerts.supplyAlerts} onChange={(event) => setAlerts((current) => ({ ...current, supplyAlerts: event.target.value }))} /></label><label><span>Quality alerts</span><input value={alerts.feedbackAlerts} onChange={(event) => setAlerts((current) => ({ ...current, feedbackAlerts: event.target.value }))} /></label></div><button type="button" onClick={() => void saveDelivery()}>Save recipients</button></article>
      <article className="card"><div className="section-heading"><div><h2>Delivery queue</h2><p>Queued {queue.counts.queued ?? 0} · Failed {queue.counts.failed ?? 0} · Sent {queue.counts.sent ?? 0}</p></div><button type="button" onClick={() => void processQueue()}>Process due</button></div><div className="delivery-jobs">{queue.items.slice(0, 20).map((job) => <div key={job.id}><strong>{job.kind.replaceAll('_', ' ')}</strong><span>{job.status} · {job.attempts}/{job.maxAttempts}</span></div>)}</div></article>
      <section><h2>Email templates</h2><div className="communication-grid">{templates.map((template) => <article className="card communication-card" key={template.id}><strong>{template.key.replaceAll('_', ' ')}</strong><label><span>Subject</span><input value={template.subject} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, subject: event.target.value } : item))} /></label><label><span>HTML body</span><textarea value={template.body} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, body: event.target.value } : item))} /></label><button type="button" onClick={() => void saveTemplate(template)}>Save template</button></article>)}</div></section>
    </section> : null}
  </main>
}
