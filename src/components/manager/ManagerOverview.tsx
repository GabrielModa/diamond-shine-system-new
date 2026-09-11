'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { operationalDayRange, operationalGreeting } from '../../lib/operational-time'
import CommandActivityFeed from './CommandActivityFeed'

type CommandData = {
  summary: {
    visitsToday: number
    inProgress: number
    completed: number
    schedulingIssues: number
    timeReview: number
    awaitingTriage: number
    urgentSupplies: number
    openIncidents: number
    criticalIncidents: number
    blockedVisits: number
    overdueActions: number
    criticalActions: number
  }
  activity: {
    supplies: Array<{ id: string; createdAt: string; employeeName: string; clientLocation: string; status: string; priority: string }>
    feedback: Array<{ id: string; createdAt: string; employeeName: string; clientLocation: string; overall: number; category: string }>
    incidents: Array<{ id: string; createdAt: string; title: string; severity: string; status: string; visit: { site: { name: string; client: { displayName: string } } } }>
  }
}

async function read<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store' })
  const body = await response.json().catch(() => null)
  return response.ok && body?.ok ? body.data as T : null
}

export default function ManagerOverview({ timezone }: { timezone: string }) {
  const [data, setData] = useState<CommandData | null>(null)
  const [loading, setLoading] = useState(true)
  const range = useMemo(() => operationalDayRange(new Date(), timezone), [timezone])

  const refresh = useCallback(async () => {
    setLoading(true)
    const next = await read<CommandData>(`/api/command-centre?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)
    setData(next)
    setLoading(false)
  }, [range])

  useEffect(() => { void refresh() }, [refresh])

  const summary = data?.summary
  const active = summary?.inProgress ?? 0
  const completed = summary?.completed ?? 0
  const schedulingIssues = summary?.schedulingIssues ?? 0
  const timeReview = summary?.timeReview ?? 0
  const awaitingTriage = summary?.awaitingTriage ?? 0
  const urgentSupplies = summary?.urgentSupplies ?? 0
  const openIncidents = summary?.openIncidents ?? 0
  const criticalIncidents = summary?.criticalIncidents ?? 0
  const blockedVisits = summary?.blockedVisits ?? 0
  const qualityAttention = Math.max(summary?.overdueActions ?? 0, summary?.criticalActions ?? 0)
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
      detail: `${summary?.overdueActions ?? 0} overdue · ${summary?.criticalActions ?? 0} critical corrective actions`,
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
      <Link href="/schedule"><span>Visits today</span><strong>{loading ? '—' : summary?.visitsToday ?? 0}</strong><small>Schedule owns the daily plan</small></Link>
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

    <CommandActivityFeed supplies={data?.activity.supplies ?? []} feedback={data?.activity.feedback ?? []} incidents={data?.activity.incidents ?? []} />
  </main>
}
