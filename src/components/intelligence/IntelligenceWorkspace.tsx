'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type SiteRisk = {
  id: string
  name: string
  city: string
  client: { displayName: string }
  score: number
  level: 'critical' | 'high' | 'watch' | 'healthy'
  reasons: string[]
  nextVisit: string | null
}
type Intelligence = {
  generatedAt: string
  health: { score: number; grade: string }
  summary: {
    historicalVisits: number
    completedVisits: number
    completionRate: number
    plannedMinutes: number
    actualMinutes: number
    laborVariancePercent: number
    timeAnomalies: number
    qualityAverage: number | null
    qualityPassRate: number | null
    materialRisks: number
    openSupplyRequests: number
    openCorrectiveActions: number
    acknowledgementGaps: number
    unassignedUpcoming: number
  }
  siteRisks: SiteRisk[]
  actionsNow: Array<{ priority: string; title: string; detail: string; href: string }>
  team: Array<{ id: string; name: string; completedVisits: number; minutes: number; anomalies: number; rating: number | null }>
}

async function loadIntelligence() {
  const response = await fetch('/api/intelligence', { credentials: 'include', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load operational intelligence.')
  return body.data as Intelligence
}
function hours(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m` }

export default function IntelligenceWorkspace() {
  const [data, setData] = useState<Intelligence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | SiteRisk['level']>('all')
  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await loadIntelligence()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load operational intelligence.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const visibleSites = useMemo(() => data?.siteRisks.filter((site) => riskFilter === 'all' || site.level === riskFilter) ?? [], [data, riskFilter])

  return <main className="page-shell intelligence-page">
    <header className="page-header intelligence-hero">
      <div><span className="eyebrow">Decision intelligence</span><h1>Operations intelligence</h1><p className="muted">One operating picture across delivery, labour, quality, materials and communication.</p></div>
      <button className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh signals</button>
    </header>
    {error ? <div className="toast error" role="alert">{error}</div> : null}
    {loading && !data ? <section className="card empty-state">Calculating operational risk…</section> : null}
    {data ? <>
      <section className="intelligence-overview">
        <article className={`health-score ${data.health.grade}`}>
          <div className="health-ring" style={{ '--health': data.health.score } as React.CSSProperties}><strong>{data.health.score}</strong><span>/100</span></div>
          <div><span>Operational health</span><h2>{data.health.grade}</h2><p>Weighted from completion, quality, time confidence, stock, communication and critical issues.</p></div>
        </article>
        <div className="intelligence-kpis">
          <article><span>Service delivery</span><strong>{data.summary.completionRate}%</strong><small>{data.summary.completedVisits}/{data.summary.historicalVisits} visits complete</small></article>
          <article className={data.summary.qualityAverage != null && data.summary.qualityAverage < 85 ? 'attention' : ''}><span>Quality</span><strong>{data.summary.qualityAverage ?? '—'}</strong><small>{data.summary.qualityPassRate ?? '—'}% inspection pass rate</small></article>
          <article className={Math.abs(data.summary.laborVariancePercent) > 15 ? 'attention' : ''}><span>Labour variance</span><strong>{data.summary.laborVariancePercent > 0 ? '+' : ''}{data.summary.laborVariancePercent}%</strong><small>{hours(data.summary.actualMinutes)} actual · {hours(data.summary.plannedMinutes)} planned</small></article>
          <article className={data.summary.timeAnomalies ? 'attention' : ''}><span>Time exceptions</span><strong>{data.summary.timeAnomalies}</strong><small>Only anomalous entries need review</small></article>
          <article className={data.summary.materialRisks ? 'attention' : ''}><span>Material risks</span><strong>{data.summary.materialRisks}</strong><small>{data.summary.openSupplyRequests} requests in progress</small></article>
          <article className={data.summary.acknowledgementGaps ? 'attention' : ''}><span>Unconfirmed changes</span><strong>{data.summary.acknowledgementGaps}</strong><small>{data.summary.unassignedUpcoming} upcoming visits unassigned</small></article>
        </div>
      </section>

      <section className="intelligence-grid">
        <div className="risk-panel card">
          <div className="section-heading"><div><h2>Location risk radar</h2><span className="muted">Highest operational exposure first</span></div><span className="count-pill">{visibleSites.length}</span></div>
          <div className="risk-filters" role="group" aria-label="Filter location risk">{(['all', 'critical', 'high', 'watch', 'healthy'] as const).map((value) => <button key={value} className={riskFilter === value ? 'selected' : ''} onClick={() => setRiskFilter(value)}>{value}</button>)}</div>
          <div className="risk-list">{visibleSites.map((site) => <article key={site.id} className="risk-row" data-risk={site.level}>
            <div className="risk-value"><strong>{site.score}</strong><span>{site.level}</span></div>
            <div className="risk-copy"><strong>{site.client.displayName} · {site.name}</strong><span>{site.city}{site.nextVisit ? ` · next ${new Date(site.nextVisit).toLocaleDateString('en-IE')}` : ''}</span><small>{site.reasons.slice(0, 3).join(' · ') || 'No active risk signals'}</small></div>
            <div className="risk-bar" aria-label={`Risk ${site.score} out of 100`}><span style={{ width: `${site.score}%` }} /></div>
          </article>)}</div>
        </div>

        <aside className="action-panel card">
          <div className="section-heading"><div><h2>Act now</h2><span className="muted">Ranked, owned work — not more charts</span></div><span className="count-pill">{data.actionsNow.length}</span></div>
          {data.actionsNow.map((action, index) => <a href={action.href} key={`${action.title}-${index}`} className="action-row"><span className={`priority-dot ${action.priority}`} /><div><strong>{action.title}</strong><small>{action.detail}</small></div><span>→</span></a>)}
          {!data.actionsNow.length ? <div className="empty-state compact">No critical action is waiting.</div> : null}
          <div className="action-links"><a href="/field-control">Open field control</a><a href="/supplies">Open materials</a><a href="/feedback">Open quality</a></div>
        </aside>
      </section>

      <section className="card team-intelligence">
        <div className="section-heading"><div><h2>Team signals</h2><span className="muted">Context for coaching and workload balance, never a single-score leaderboard</span></div><span>{data.team.length} team members</span></div>
        <div className="team-table" role="table"><div className="team-row team-head" role="row"><span>Team member</span><span>Completed</span><span>Tracked time</span><span>Exceptions</span><span>Feedback</span></div>{data.team.map((member) => <div className="team-row" role="row" key={member.id}><strong>{member.name}</strong><span>{member.completedVisits}</span><span>{hours(member.minutes)}</span><span className={member.anomalies ? 'warning-text' : ''}>{member.anomalies}</span><span>{member.rating == null ? '—' : `${member.rating}/5`}</span></div>)}</div>
      </section>
      <p className="intelligence-timestamp">Signals recalculated {new Date(data.generatedAt).toLocaleString('en-IE')} · every number links back to operational records.</p>
    </> : null}
  </main>
}
