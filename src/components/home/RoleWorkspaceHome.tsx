'use client'

import { useEffect, useState } from 'react'
import { clientApi } from '../../lib/client-api'

type Visit = { id: string; scheduledStart: string; scheduledEnd: string; status: string; site: { name: string; client: { displayName: string } } }
type HomeSummary = { nextVisit: Visit | null; awaitingAcknowledgement: number; openRequests: number }

type Props = { roleLabel: string; timezone: string; canSchedule: boolean; canSupplies: boolean; canQuality: boolean; canTimeReview: boolean; canFinance: boolean }

export default function RoleWorkspaceHome({ roleLabel, timezone, canSchedule, canSupplies, canQuality, canTimeReview, canFinance }: Props) {
  const [summary, setSummary] = useState<HomeSummary | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => { void (async () => {
    setLoading(true); setError('')
    try { setSummary(await clientApi<HomeSummary>('/api/home-summary', undefined, 'Could not load your workspace')) }
    catch (cause) { setSummary(null); setError(cause instanceof Error ? cause.message : 'Could not load your workspace.') }
    finally { setLoading(false) }
  })() }, [])
  const next = summary?.nextVisit ?? null
  const openRequests = summary?.openRequests ?? 0
  return <main className="page-shell role-home"><header className="manager-home-hero"><div><span className="eyebrow">Your operational workspace · {roleLabel}</span><h1>What needs your attention</h1><p>Only the work and controls relevant to your operational role are shown here.</p></div></header>{error ? <div className="inline-message error" role="alert">{error}</div> : null}<section className="role-home-grid">{canSchedule ? <article className="card role-home-primary"><span className="eyebrow">Next work</span>{loading ? <h2>Loading…</h2> : next ? <><h2>{next.site.client.displayName}</h2><p>{next.site.name} · {new Date(next.scheduledStart).toLocaleString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone })}</p><a className="btn-primary" href={`/schedule?visit=${encodeURIComponent(next.id)}`}>Open next assignment</a></> : <><h2>No upcoming work</h2><p className="muted">Nothing assigned in the next seven days.</p><a className="btn-secondary" href="/schedule">Open schedule</a></>}</article> : null}<article className="card"><span className="eyebrow">Team inbox</span><strong className="role-home-number">{summary?.awaitingAcknowledgement ?? 0}</strong><p className="muted">notice{(summary?.awaitingAcknowledgement ?? 0) === 1 ? '' : 's'} waiting for acknowledgement</p><a className="btn-secondary" href="/communications">Open inbox</a></article>{canSupplies ? <article className="card"><span className="eyebrow">Materials</span><strong className="role-home-number">{openRequests}</strong><p className="muted">open request{openRequests === 1 ? '' : 's'}</p><a className="btn-secondary" href="/supplies">Open materials</a></article> : null}{canQuality ? <article className="card"><span className="eyebrow">Quality assurance</span><h2>Inspect & verify</h2><p className="muted">Review service outcomes and corrective actions.</p><a className="btn-secondary" href="/quality">Open quality</a></article> : null}{canTimeReview || canFinance ? <article className="card"><span className="eyebrow">Time & payroll</span><h2>{canFinance ? 'Payroll readiness' : 'Review team time'}</h2><p className="muted">Use the approved review period as the source of truth.</p><a className="btn-secondary" href="/timesheets">Open timesheets</a></article> : null}</section></main>
}
