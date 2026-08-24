'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Site = { id: string; name: string; client: { displayName: string } }
type Visit = { id: string; scheduledStart: string; status: string; job: { name: string } }
type CheckResult = 'pass' | 'fail' | 'not_applicable' | ''
type Check = { category: string; title: string; weight: number; critical: boolean; result: CheckResult; finding: string }
type Action = {
  id: string
  title: string
  description?: string | null
  severity: 'minor' | 'major' | 'critical'
  status: 'open' | 'accepted' | 'in_progress' | 'resolved' | 'verified' | 'waived'
  dueAt: string
  version: number
  site: Site
  assignedTo?: { name?: string | null; email: string } | null
  inspection: { id: string; score: number; inspectedAt: string }
}
type Inspection = {
  id: string
  score: number
  grade: string
  passed: boolean
  summary?: string | null
  inspectedAt: string
  status: string
  clientVisible?: boolean
  site: Site
  inspector: { name?: string | null; email: string }
  _count?: { actions: number }
  items?: Array<{ id: string; result: string; title: string; critical: boolean; finding?: string | null }>
  actions?: Action[]
}
type Control = {
  summary: {
    inspections: number
    averageScore: number | null
    passRate: number | null
    openActions: number
    overdueActions: number
    criticalActions: number
    uninspectedSites: number
  }
  inspections: Inspection[]
  actions: Action[]
  sites: Array<Site & { qualityInspections: Array<{ inspectedAt: string; score: number; passed: boolean }> }>
}

const CHECK_TEMPLATE: Check[] = [
  { category: 'Service quality', title: 'Floors, edges and corners are visibly clean', weight: 3, critical: false, result: '', finding: '' },
  { category: 'Service quality', title: 'Desks, touchpoints and surfaces are dust-free', weight: 2, critical: false, result: '', finding: '' },
  { category: 'Hygiene', title: 'Washrooms meet hygiene and presentation standard', weight: 4, critical: true, result: '', finding: '' },
  { category: 'Hygiene', title: 'Kitchen and food-contact areas are sanitised', weight: 3, critical: true, result: '', finding: '' },
  { category: 'Waste', title: 'Waste is removed, segregated and liners replaced', weight: 2, critical: false, result: '', finding: '' },
  { category: 'Security', title: 'Windows, doors, lights and alarm close-down completed', weight: 4, critical: true, result: '', finding: '' },
  { category: 'Presentation', title: 'Consumables are stocked and the site is client-ready', weight: 2, critical: false, result: '', finding: '' },
]

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init })
  const body = await response.json().catch(() => null) as { data?: T; error?: string } | null
  if (!response.ok || !body?.data) throw new Error(body?.error ?? 'Request failed')
  return body.data
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function previewScore(checks: Check[]) {
  const applicable = checks.filter((check) => check.result && check.result !== 'not_applicable')
  const total = applicable.reduce((sum, check) => sum + check.weight, 0)
  const earned = applicable.filter((check) => check.result === 'pass').reduce((sum, check) => sum + check.weight, 0)
  const criticalFailure = applicable.some((check) => check.critical && check.result === 'fail')
  const raw = total ? Math.round((earned / total) * 100) : 100
  return criticalFailure ? Math.min(raw, 49) : raw
}

export default function QualityWorkspace() {
  const [tab, setTab] = useState<'control' | 'inspect' | 'actions' | 'history'>('control')
  const [control, setControl] = useState<Control | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [siteId, setSiteId] = useState('')
  const [visitId, setVisitId] = useState('')
  const [inspectionType, setInspectionType] = useState('routine')
  const [summary, setSummary] = useState('')
  const [clientVisible, setClientVisible] = useState(false)
  const [checks, setChecks] = useState<Check[]>(CHECK_TEMPLATE.map((check) => ({ ...check })))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [clientReport, setClientReport] = useState<{ client: string; site: string; service: string; serviceDate: string; score: number; grade: string; summary?: string | null; completedStandards: Array<{ category: string; title: string }>; followUps: Array<{ title: string; severity: string; status: string; dueAt: string }>; status: string } | null>(null)

  const refresh = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const [nextControl, nextSites] = await Promise.all([
        api<Control>('/api/quality/control'),
        api<Site[]>('/api/sites'),
      ])
      setControl(nextControl)
      setSites(nextSites)
      setSiteId((current) => nextSites.some((site) => site.id === current) ? current : nextSites[0]?.id ?? '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load quality control.')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!siteId) { setVisits([]); setVisitId(''); return }
    api<Visit[]>(`/api/visits?siteId=${encodeURIComponent(siteId)}`)
      .then((items) => { setVisits(items); setVisitId((current) => items.some((visit) => visit.id === current) ? current : '') })
      .catch(() => { setVisits([]); setVisitId('') })
  }, [siteId])

  const score = useMemo(() => previewScore(checks), [checks])
  const complete = checks.every((check) => check.result && (check.result !== 'fail' || check.finding.trim()))
  const groupedChecks = useMemo(() => {
    const groups = new Map<string, Array<{ check: Check; index: number }>>()
    checks.forEach((check, index) => groups.set(check.category, [...(groups.get(check.category) ?? []), { check, index }]))
    return [...groups.entries()]
  }, [checks])

  function updateCheck(index: number, patch: Partial<Check>) {
    setChecks((current) => current.map((check, itemIndex) => itemIndex === index ? { ...check, ...patch } : check))
  }

  async function submitInspection() {
    if (!siteId || !complete) return
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await api<{ id: string; score: number; actions: Action[] }>('/api/quality/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId,
          visitId: visitId || null,
          type: inspectionType,
          summary: summary.trim() || null,
          clientVisible,
          items: checks.map((check, index) => ({ ...check, sortOrder: index, finding: check.finding.trim() || null })),
        }),
      })
      setNotice(`Inspection ${created.score}/100 saved. ${created.actions.length} corrective action${created.actions.length === 1 ? '' : 's'} opened.`)
      setChecks(CHECK_TEMPLATE.map((check) => ({ ...check })))
      setSummary(''); setClientVisible(false); setVisitId('')
      await refresh()
      setTab(created.actions.length ? 'actions' : 'control')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save inspection.')
    } finally {
      setBusy(false)
    }
  }

  async function moveAction(action: Action, status: Action['status']) {
    const resolutionNote = status === 'resolved'
      ? window.prompt('Describe the fix and evidence available:')
      : status === 'verified'
        ? window.prompt('Record the verification performed:')
        : status === 'waived'
          ? window.prompt('Record why this action is waived:')
          : null
    if (['resolved', 'verified', 'waived'].includes(status) && !resolutionNote?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`/api/quality/actions/${action.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, version: action.version, resolutionNote: resolutionNote?.trim() || null }),
      })
      setNotice(`Corrective action moved to ${status.replace('_', ' ')}.`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update corrective action.')
    } finally {
      setBusy(false)
    }
  }

  async function previewClientReport(inspectionId: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      setClientReport(await api(`/api/quality/inspections/${inspectionId}/client-report`))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create client-safe report preview.')
    } finally {
      setBusy(false)
    }
  }

  const summaryCards = control ? [
    ['30-day score', control.summary.averageScore == null ? '—' : `${control.summary.averageScore}`, `${control.summary.inspections} inspections`],
    ['Pass rate', control.summary.passRate == null ? '—' : `${control.summary.passRate}%`, 'Verified quality'],
    ['Open actions', `${control.summary.openActions}`, `${control.summary.overdueActions} overdue`],
    ['Critical', `${control.summary.criticalActions}`, `${control.summary.uninspectedSites} sites uninspected`],
  ] : []

  return (
    <main className="page-shell quality-workspace">
      <section className="quality-hero">
        <div>
          <span className="eyebrow">Cleaning quality assurance</span>
          <h1>Quality control</h1>
          <p>Inspect the delivered outcome, open corrective work automatically and verify the fix.</p>
        </div>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={busy}>↻ Refresh</button>
      </section>
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
      <nav className="materials-tabs" aria-label="Quality views">
        {([['control', 'Control centre'], ['inspect', 'New inspection'], ['actions', 'Corrective actions'], ['history', 'History']] as const).map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {tab === 'control' && control ? <>
        <section className="materials-summary" aria-label="Quality summary">
          {summaryCards.map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}
        </section>
        <section className="quality-control-grid">
          <article className="card"><h2>Latest inspections</h2><p className="muted">Outcome by site, not a vanity employee rating.</p>
            <div className="quality-list">{control.inspections.slice(0, 8).map((inspection) => <div className="quality-row" key={inspection.id}>
              <span className={`quality-score ${inspection.passed ? 'pass' : 'fail'}`}>{inspection.score}</span>
              <div><strong>{inspection.site.name}</strong><small>{inspection.site.client.displayName} · {formatDate(inspection.inspectedAt)}</small></div>
              <span className="status-pill">{inspection.grade}</span>
            </div>)}{control.inspections.length === 0 ? <p className="empty-copy">No inspections yet.</p> : null}</div>
          </article>
          <article className="card"><h2>Sites needing assurance</h2><p className="muted">Never inspected or last result below standard.</p>
            <div className="quality-list">{control.sites.filter((site) => !site.qualityInspections[0] || !site.qualityInspections[0].passed).map((site) => <button type="button" className="quality-site-row" key={site.id} onClick={() => { setSiteId(site.id); setTab('inspect') }}>
              <div><strong>{site.name}</strong><small>{site.client.displayName}</small></div><span>{site.qualityInspections[0] ? `${site.qualityInspections[0].score}/100` : 'Inspect now →'}</span>
            </button>)}{control.sites.length === 0 ? <p className="empty-copy">Create a client site first.</p> : null}</div>
          </article>
        </section>
      </> : null}

      {tab === 'inspect' ? <section className="quality-inspection-layout">
        <article className="card quality-inspection-form">
          <div className="quality-form-head"><div><h2>Outcome inspection</h2><p className="muted">Issue requires a finding; failed checks create tracked actions.</p></div><div className={`quality-score large ${complete ? (score >= 80 ? 'pass' : 'fail') : ''}`}>{complete ? score : '—'}</div></div>
          <div className="quality-meta-grid">
            <label>Client site<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.client.displayName} · {site.name}</option>)}</select></label>
            <label>Related visit<select value={visitId} onChange={(event) => setVisitId(event.target.value)}><option value="">Site inspection (no visit)</option>{visits.map((visit) => <option key={visit.id} value={visit.id}>{formatDate(visit.scheduledStart)} · {visit.job.name}</option>)}</select></label>
            <label>Inspection type<select value={inspectionType} onChange={(event) => setInspectionType(event.target.value)}><option value="routine">Routine</option><option value="spot_check">Spot check</option><option value="post_incident">Post incident</option><option value="client_complaint">Client complaint</option><option value="handover">Handover</option></select></label>
            <label className="quality-client-toggle"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /> Client-safe report</label>
          </div>
          {groupedChecks.map(([category, entries]) => <fieldset className="quality-check-group" key={category}><legend>{category}</legend>{entries.map(({ check, index }) => <div className={`quality-check ${check.result === 'fail' ? 'has-finding' : ''}`} key={check.title}>
            <div><strong>{check.title}</strong><small>{check.critical ? 'Critical standard' : `Weight ${check.weight}`}</small></div>
            <div className="quality-result-buttons" role="group" aria-label={check.title}>
              {([['pass', 'Pass'], ['fail', 'Issue'], ['not_applicable', 'N/A']] as const).map(([value, label]) => <button key={value} type="button" className={check.result === value ? `active ${value}` : ''} onClick={() => updateCheck(index, { result: value, finding: value === 'fail' ? check.finding : '' })}>{label}</button>)}
            </div>
            {check.result === 'fail' ? <textarea aria-label={`${check.title} finding`} placeholder="Describe what is wrong and what good looks like…" value={check.finding} onChange={(event) => updateCheck(index, { finding: event.target.value })} /> : null}
          </div>)}</fieldset>)}
          <label>Inspection summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Context, access constraints or overall observation…" /></label>
          <button type="button" onClick={() => void submitInspection()} disabled={busy || !siteId || !complete}>{busy ? 'Saving inspection…' : 'Submit inspection & open actions'}</button>
        </article>
      </section> : null}

      {tab === 'actions' && control ? <section className="quality-actions"><div className="section-heading"><div><h2>Corrective action board</h2><p>Own every failure through verified closure.</p></div></div>
        <div className="quality-action-grid">{control.actions.map((action) => <article className={`quality-action-card ${action.severity}`} key={action.id}>
          <div className="quality-action-head"><span>{action.severity}</span><span>{action.status.replace('_', ' ')}</span></div>
          <h3>{action.title}</h3><p>{action.description || 'Correct the failed standard and attach evidence.'}</p>
          <small>{action.site.client.displayName} · {action.site.name}</small><small>Due {formatDate(action.dueAt)} · {action.assignedTo?.name ?? action.assignedTo?.email ?? 'Unassigned'}</small>
          <div className="quality-action-buttons">
            {action.status === 'open' ? <button type="button" onClick={() => void moveAction(action, 'accepted')}>Accept</button> : null}
            {['open', 'accepted'].includes(action.status) ? <button type="button" onClick={() => void moveAction(action, 'in_progress')}>Start</button> : null}
            {['open', 'accepted', 'in_progress'].includes(action.status) ? <button type="button" onClick={() => void moveAction(action, 'resolved')}>Resolve</button> : null}
            {action.status === 'resolved' ? <button type="button" onClick={() => void moveAction(action, 'verified')}>Verify fix</button> : null}
          </div>
        </article>)}{control.actions.length === 0 ? <p className="empty-copy">No open corrective actions.</p> : null}</div>
      </section> : null}

      {tab === 'history' && control ? <section className="card"><h2>Inspection history</h2><div className="quality-history">{control.inspections.map((inspection) => <article key={inspection.id}>
        <span className={`quality-score ${inspection.passed ? 'pass' : 'fail'}`}>{inspection.score}</span><div><strong>{inspection.site.client.displayName} · {inspection.site.name}</strong><small>{inspection.inspector.name ?? inspection.inspector.email} · {formatDate(inspection.inspectedAt)}</small></div><span>{inspection._count?.actions ?? 0} actions</span>{inspection.clientVisible ? <button type="button" className="btn-secondary compact" disabled={busy} onClick={() => void previewClientReport(inspection.id)}>Client report</button> : null}
      </article>)}{control.inspections.length === 0 ? <p className="empty-copy">No inspections yet.</p> : null}</div></section> : null}
      {clientReport ? <section className="client-report-card card" aria-live="polite"><div className="section-heading"><div><span className="eyebrow">Client-safe service report</span><h2>{clientReport.client} · {clientReport.site}</h2><p className="muted">No employee identities, internal notes, GPS or internal evidence.</p></div><button type="button" className="btn-ghost" onClick={() => setClientReport(null)}>Close</button></div><div className="client-report-summary"><strong>{clientReport.score}/100 · {clientReport.grade}</strong><span>{formatDate(clientReport.serviceDate)} · {clientReport.service}</span><span className="status-pill">{clientReport.status.replaceAll('_', ' ')}</span></div>{clientReport.summary ? <p>{clientReport.summary}</p> : null}<div className="client-report-columns"><div><h3>Completed standards</h3>{clientReport.completedStandards.length ? <ul>{clientReport.completedStandards.map((item) => <li key={`${item.category}-${item.title}`}>{item.title}</li>)}</ul> : <p className="muted">Verified during inspection.</p>}</div><div><h3>Follow-up</h3>{clientReport.followUps.length ? <ul>{clientReport.followUps.map((item) => <li key={`${item.title}-${item.dueAt}`}>{item.title} · {item.status.replaceAll('_', ' ')}</li>)}</ul> : <p className="muted">No client-facing follow-up is open.</p>}</div></div></section> : null}
    </main>
  )
}
