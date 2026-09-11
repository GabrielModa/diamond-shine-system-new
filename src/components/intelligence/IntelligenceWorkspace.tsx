'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { clientApi } from '../../lib/client-api'
import ListControls from '../ui/ListControls'

type SiteRisk = { id: string; name: string; city: string; client: { displayName: string }; score: number; level: 'critical' | 'high' | 'watch' | 'healthy'; reasons: string[] }
type HealthComponent = { key: string; label: string; weight: number; value: number | null; direction: string }
type Trend = { current: number | null; previous: number | null; delta: number | null }
type Intelligence = {
  generatedAt: string
  health: { score: number | null; grade: 'excellent' | 'healthy' | 'watch' | 'critical' | 'no_data'; confidence: number; components: HealthComponent[] }
  summary: {
    historicalVisits: number
    completedVisits: number
    completionRate: number | null
    plannedMinutes: number
    actualMinutes: number
    laborVariancePercent: number | null
    timeAnomalies: number
    qualityAverage: number | null
    qualityPassRate: number | null
    materialRisks: number
    openSupplyRequests: number
    openCorrectiveActions: number
    acknowledgementGaps: number
    openIncidents: number
  }
  trends: {
    completionRate: Trend
    quality: Trend
    laborVariance: Trend
    incidents: Trend
    timeExceptions: Trend
  }
  siteRisks: SiteRisk[]
}

async function loadIntelligence() {
  return clientApi<Intelligence>('/api/intelligence', undefined, 'Could not load operational insights')
}

function hours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
function valueOrDash(value: number | null, suffix = '') {
  return value == null ? '—' : `${value}${suffix}`
}
function trendCopy(trend: Trend, lowerIsBetter = false) {
  if (trend.delta == null) return 'No comparable previous period'
  if (trend.delta === 0) return 'No change vs previous 30 days'
  const improved = lowerIsBetter ? trend.delta < 0 : trend.delta > 0
  return `${trend.delta > 0 ? '+' : ''}${trend.delta} vs previous 30 days · ${improved ? 'improving' : 'needs attention'}`
}

export default function IntelligenceWorkspace() {
  const [data, setData] = useState<Intelligence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [riskFilter, setRiskFilter] = useState<'attention' | 'all' | SiteRisk['level']>('attention')
  const [showHealth, setShowHealth] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await loadIntelligence())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load operational insights.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const visibleSites = useMemo(() => data?.siteRisks.filter((site) => {
    if (riskFilter === 'all') return true
    if (riskFilter === 'attention') return site.level !== 'healthy'
    return site.level === riskFilter
  }) ?? [], [data, riskFilter])

  return <main className="page-shell intelligence-page">
    <header className="page-header intelligence-hero">
      <div>
        <span className="eyebrow">30-day operational trends</span>
        <h1>Operational insights</h1>
        <p className="muted">See where delivery, labour, quality and operational risk are improving or drifting. Scheduling and coverage decisions stay in Schedule.</p>
      </div>
      <button className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh insights</button>
    </header>

    {error ? <div className="toast error" role="alert">{error}</div> : null}
    {loading && !data ? <section className="card empty-state">Calculating operational trends…</section> : null}

    {data ? <>
      <section className="intelligence-overview">
        <article className={`health-score ${data.health.grade}`}>
          <div className="health-ring" style={{ '--health': data.health.score ?? 0 } as React.CSSProperties}>
            <strong>{data.health.score ?? '—'}</strong><span>/100</span>
          </div>
          <div>
            <span>30-day operational health</span>
            <h2>{data.health.grade === 'no_data' ? 'Not enough data' : data.health.grade}</h2>
            <p>{data.health.confidence}% data confidence. Missing quality, stock or acknowledgement data is excluded rather than treated as perfect performance.</p>
            <button type="button" className="text-button" aria-expanded={showHealth} onClick={() => setShowHealth((value) => !value)}>{showHealth ? 'Hide score logic' : 'Why this score?'}</button>
          </div>
        </article>

        <div className="intelligence-kpis">
          <article>
            <span>Service delivery</span>
            <strong>{valueOrDash(data.summary.completionRate, '%')}</strong>
            <small>{data.summary.completedVisits}/{data.summary.historicalVisits} visits complete · {trendCopy(data.trends.completionRate)}</small>
          </article>
          <article className={data.summary.qualityAverage != null && data.summary.qualityAverage < 85 ? 'attention' : ''}>
            <span>Quality</span>
            <strong>{valueOrDash(data.summary.qualityAverage)}</strong>
            <small>{data.summary.qualityPassRate == null ? 'No inspection pass-rate data' : data.summary.qualityPassRate + '% inspection pass rate'} · {trendCopy(data.trends.quality)}</small>
          </article>
          <article className={data.summary.laborVariancePercent != null && Math.abs(data.summary.laborVariancePercent) > 15 ? 'attention' : ''}>
            <span>Labour variance</span>
            <strong>{data.summary.laborVariancePercent == null ? '—' : (data.summary.laborVariancePercent > 0 ? '+' : '') + data.summary.laborVariancePercent + '%'}</strong>
            <small>{hours(data.summary.actualMinutes)} actual · {hours(data.summary.plannedMinutes)} planned labour · {trendCopy(data.trends.laborVariance, true)}</small>
          </article>
          <article className={data.summary.timeAnomalies ? 'attention' : ''}>
            <span>Time exceptions</span>
            <strong>{data.summary.timeAnomalies}</strong>
            <small>{trendCopy(data.trends.timeExceptions, true)}</small>
          </article>
          <article className={data.summary.materialRisks ? 'attention' : ''}>
            <span>Material risks</span>
            <strong>{data.summary.materialRisks}</strong>
            <small>{data.summary.openSupplyRequests} open requests · stock readiness signal</small>
          </article>
          <article className={data.summary.openCorrectiveActions || data.summary.openIncidents ? 'attention' : ''}>
            <span>Service risk</span>
            <strong>{data.summary.openIncidents + data.summary.openCorrectiveActions}</strong>
            <small>{data.summary.openIncidents} incidents · {data.summary.openCorrectiveActions} corrective actions</small>
          </article>
        </div>
      </section>

      {showHealth ? <section className="card health-explainer" aria-label="Operational health score components">
        <div className="section-heading"><div><h2>How operational health is calculated</h2><p className="muted">Only signals with real data contribute to the score. The visible confidence shows how much of the model is populated.</p></div></div>
        <div className="health-components">{data.health.components.map((component) => <article key={component.key}>
          <div><strong>{component.label}</strong><span>{component.weight}% possible weight</span></div>
          <div className="health-component-bar"><span style={{ width: `${Math.max(0, Math.min(100, component.value ?? 0))}%` }} /></div>
          <b>{component.value == null ? 'No data' : component.value + '/100'}</b>
        </article>)}</div>
      </section> : null}

      <section className="risk-panel card">
        <div className="section-heading">
          <div><h2>Sites to watch</h2><span className="muted">30-day operational exposure from incidents, quality, materials, corrective actions and acknowledged communication.</span></div>
          <span className="count-pill">{visibleSites.length}</span>
        </div>
        <div className="risk-standard-filter">
          <ListControls query="" onQueryChange={() => undefined} hideSearch hasActiveFilters={riskFilter !== 'attention'} onClear={() => setRiskFilter('attention')} options={[{
            label: 'Risk level',
            value: riskFilter,
            defaultValue: 'attention',
            choices: [
              { value: 'attention', label: 'Needs attention' },
              { value: 'critical', label: 'Critical' },
              { value: 'high', label: 'High' },
              { value: 'watch', label: 'Watch' },
              { value: 'healthy', label: 'Healthy' },
              { value: 'all', label: 'All sites' },
            ],
            onChange: (value) => setRiskFilter(value as typeof riskFilter),
          }]} />
        </div>
        <div className="risk-list">
          {visibleSites.map((site) => <article key={site.id} className="risk-row" data-risk={site.level}>
            <div className="risk-value"><strong>{site.score}</strong><span>{site.level}</span></div>
            <div className="risk-copy"><strong>{site.client.displayName} · {site.name}</strong><span>{site.city}</span><small>{site.reasons.slice(0, 3).join(' · ') || 'No active risk signals in the last 30 days'}</small></div>
            <div className="risk-bar" aria-label={`Risk ${site.score} out of 100`}><span style={{ width: `${site.score}%` }} /></div>
          </article>)}
          {!visibleSites.length ? <div className="empty-state compact">No sites match this risk view.</div> : null}
        </div>
      </section>

      <p className="intelligence-timestamp">Insights recalculated {new Date(data.generatedAt).toLocaleString('en-IE')} · scheduling and coverage remain owned by Schedule.</p>
    </> : null}
  </main>
}
