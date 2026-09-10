'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { operationalDayRange, operationalGreeting } from '../../lib/operational-time'
import CommandActivityFeed from './CommandActivityFeed'

type Visit = { id: string; status: string }
type TimeEntry = { id: string; status: string; disputes: Array<{ status: string }> }
type SupplyResponse = { items: Array<{ id: string; createdAt: string; employeeName: string; clientLocation: string; status: string; priority: string }> }
type FeedbackResponse = { items: Array<{ id: string; createdAt: string; employeeName: string; clientLocation: string; overall: number; category: string }> }
type FieldSummary = { summary: { openIncidents: number; criticalIncidents: number; needsReview: number; blocked: number }; incidents: Array<{ id: string; createdAt: string; title: string; severity: string; status: string; visit: { site: { name: string; client: { displayName: string } } } }> }
type QualitySummary = { summary: { openActions: number; overdueActions: number; criticalActions: number } }
type ScheduleHealth = { summary: { attention: number } }

async function read<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
  const body = await response.json().catch(() => null)
  return response.ok && body?.ok ? body.data as T : null
}

export default function ManagerOverview({ timezone }: { timezone: string }) {
  const [visits, setVisits] = useState<Visit[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [supplies, setSupplies] = useState<SupplyResponse | null>(null)
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null)
  const [field, setField] = useState<FieldSummary | null>(null)
  const [quality, setQuality] = useState<QualitySummary | null>(null)
  const [health, setHealth] = useState<ScheduleHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const range = useMemo(() => operationalDayRange(new Date(), timezone), [timezone])

  const refresh = useCallback(async () => {
    setLoading(true)
    const [visitData, entryData, supplyData, feedbackData, fieldData, qualityData, healthData] = await Promise.all([
      read<Visit[]>(`/api/visits?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
      read<TimeEntry[]>('/api/time-entries'),
      read<SupplyResponse>('/api/supplies?limit=200'),
      read<FeedbackResponse>('/api/feedback?page=1&pageSize=20'),
      read<FieldSummary>('/api/field-control'),
      read<QualitySummary>('/api/quality/control'),
      read<ScheduleHealth>(`/api/schedule-health?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
    ])
    setVisits(visitData ?? [])
    setEntries(entryData ?? [])
    setSupplies(supplyData)
    setFeedback(feedbackData)
    setField(fieldData)
    setQuality(qualityData)
    setHealth(healthData)
    setLoading(false)
  }, [range])

  useEffect(() => { void refresh() }, [refresh])

  const active = visits.filter((visit) => visit.status === 'in_progress').length
  const completed = visits.filter((visit) => visit.status === 'completed').length
  const schedulingIssues = health?.summary.attention ?? 0
  const timeReview = entries.filter((entry) => entry.status === 'needs_review' || entry.disputes.some((dispute) => dispute.status === 'open')).length
  const openSupplies = supplies?.items.filter((item) => !['Delivered', 'Rejected', 'Cancelled'].includes(item.status)) ?? []
  const awaitingTriage = openSupplies.filter((item) => item.status === 'Requested').length
  const urgentSupplies = openSupplies.filter((item) => item.priority === 'urgent').length
  const openIncidents = field?.summary.openIncidents ?? 0
  const criticalIncidents = field?.summary.criticalIncidents ?? 0
  const blockedVisits = field?.summary.blocked ?? 0
  const qualityAttention = Math.max(quality?.summary.overdueActions ?? 0, quality?.summary.criticalActions ?? 0)
  const attentionTotal = schedulingIssues + openIncidents + timeReview + qualityAttention + awaitingTriage
  const now = new Date()

  const attention = [
    schedulingIssues ? {
      href: '/schedule',
      title: 'Schedule needs attention',
      detail: `${schedulingIssues} coverage or continuity issue${schedulingIssues === 1 ? '' : 's'} · resolve in Schedule`,
    } : null,
    openIncidents ? {
      href: '/field-control',
      title: 'Field incidents are open',
      detail: `${openIncidents} open · ${criticalIncidents} critical · ${blockedVisits} blocked visit${blockedVisits === 1 ? '' : 's'}`,
    } : null,
    awaitingTriage ? {
      href: '/supplies',
      title: 'Supply requests are waiting',
      detail: `${awaitingTriage} waiting for triage · ${urgentSupplies} urgent · process in Supplies`,
    } : null,
    qualityAttention ? {
      href: '/quality',
      title: 'Quality needs a decision',
      detail: `${quality?.summary.overdueActions ?? 0} overdue · ${quality?.summary.criticalActions ?? 0} critical corrective actions`,
    } : null,
    timeReview ? {
      href: '/timesheets',
      title: 'Time exceptions need review',
      detail: `${timeReview} time record${timeReview === 1 ? '' : 's'} need a manager decision`,
    } : null,
  ].filter((item): item is { href: string; title: string; detail: string } => Boolean(item))

  return <main className="page-shell manager-overview">
    <header className="manager-home-hero">
      <div>
        <span className="eyebrow">Operations command centre</span>
        <h1>{operationalGreeting(now, timezone)}</h1>
        <p>See what needs attention now, then jump to the workspace that owns the decision.</p>
      </div>
      <div className="manager-home-actions">
        <Link href="/supplies" className="btn-primary">Open supplies</Link>
        <Link href="/schedule" className="btn-secondary">Open schedule</Link>
      </div>
    </header>

    <section className="command-metrics" aria-label="Today's operations">
      <Link href="/schedule"><span>Visits today</span><strong>{loading ? '—' : visits.length}</strong><small>Schedule owns the daily plan</small></Link>
      <Link href="/live-operations"><span>In progress</span><strong>{loading ? '—' : active}</strong><small>Live workforce right now</small></Link>
      <Link href="/field-control"><span>Completed</span><strong>{loading ? '—' : completed}</strong><small>Delivered visits today</small></Link>
      <Link href="#attention"><span>Needs attention</span><strong>{loading ? '—' : attentionTotal}</strong><small>{attentionTotal ? 'Exceptions only' : 'No active exception queue'}</small></Link>
    </section>

    <section className="command-grid" id="attention">
      <section className="card command-actions">
        <span className="eyebrow">Needs attention</span>
        <h2>{loading ? 'Checking the operation…' : attention.length ? 'Decisions waiting now' : 'Everything looks clear'}</h2>
        {!loading && attention.map((item) => <Link href={item.href} key={item.title}><b>{item.title}</b><span>{item.detail}</span>→</Link>)}
        {!loading && !attention.length ? <p className="muted">There are no scheduling, field, supply, quality or time exceptions waiting for action.</p> : null}
      </section>

      <aside className="card command-actions">
        <span className="eyebrow">Workspaces</span>
        <h2>Go where the work belongs</h2>
        <Link href="/schedule"><b>Schedule</b><span>Plan visits, coverage, assignments and conflicts.</span>→</Link>
        <Link href="/supplies"><b>Supplies</b><span>Process requests, procurement and stock in one place.</span>→</Link>
        <Link href="/field-control"><b>Field control</b><span>Handle live visit incidents, evidence and blockers.</span>→</Link>
        <Link href="/insights"><b>Operational insights</b><span>Review longer-term delivery, quality and risk patterns.</span>→</Link>
      </aside>
    </section>

    <CommandActivityFeed supplies={supplies?.items ?? []} feedback={feedback?.items ?? []} incidents={field?.incidents ?? []} />
  </main>
}
