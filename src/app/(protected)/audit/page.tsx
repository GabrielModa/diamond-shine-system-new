'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse } from '../../../types'
import ListControls from '../../../components/ui/ListControls'
import PaginationControls from '../../../components/ui/PaginationControls'
import OpsIcon, { type OpsIconName } from '../../../components/ui/OpsIcon'
import styles from './AuditPage.module.css'

type AuditLog = {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string | null
  metadata: string | null
  createdAt: string
}

type AuditData = {
  items: AuditLog[]
  total: number
  page: number
  limit: number
  totalPages: number
  targetTypes: string[]
  actors: string[]
  actions: string[]
}

const EMPTY_DATA: AuditData = {
  items: [],
  total: 0,
  page: 1,
  limit: 30,
  totalPages: 1,
  targetTypes: [],
  actors: [],
  actions: [],
}

export default function AuditPage() {
  const [data, setData] = useState<AuditData>(EMPTY_DATA)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('all')
  const [actor, setActor] = useState('all')
  const [action, setAction] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const hasActiveFilters = Boolean(query.trim() || from || to || target !== 'all' || actor !== 'all' || action !== 'all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' })
      if (query.trim()) params.set('search', query.trim())
      if (target !== 'all') params.set('targetType', target)
      if (actor !== 'all') params.set('actor', actor)
      if (action !== 'all') params.set('action', action)
      if (from) params.set('from', `${from}T00:00:00.000Z`)
      if (to) params.set('to', `${to}T23:59:59.999Z`)
      const response = await fetch(`/api/audit?${params}`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json() as ApiResponse<AuditData>
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Failed to load audit trail')
      setData(payload.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load audit trail')
    } finally {
      setLoading(false)
    }
  }, [action, actor, from, page, query, target, to])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    setPage(1)
    setExpanded(null)
  }, [action, actor, query, target, from, to])

  const options = useMemo(() => [
    {
      label: 'Person',
      value: actor,
      defaultValue: 'all',
      choices: [{ value: 'all', label: 'All people' }, ...data.actors.map((item) => ({ value: item, label: item }))],
      onChange: setActor,
    },
    {
      label: 'Action type',
      value: action,
      defaultValue: 'all',
      choices: [{ value: 'all', label: 'All action types' }, ...data.actions.map((item) => ({ value: item, label: humanizeAction(item) }))],
      onChange: setAction,
    },
    {
      label: 'Entity',
      value: target,
      defaultValue: 'all',
      choices: [{ value: 'all', label: 'All entities' }, ...data.targetTypes.map((item) => ({ value: item, label: targetLabel(item) }))],
      onChange: setTarget,
    },
  ], [action, actor, data.actions, data.actors, data.targetTypes, target])

  return <main className={`page-shell audit-page ${styles.workspace}`}>
    <header className="page-header"><div><span className="eyebrow">Governance & traceability</span><h1>Audit trail</h1><p className="muted">Understand who changed what, when it happened and which record was affected. Expand any event for the raw trace metadata.</p></div></header>

    <section className={`card ${styles.controlCard}`}>
      <div className={styles.toolbarRow}>
        <ListControls
          query={query}
          onQueryChange={setQuery}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          placeholder="Search action, person, entity or record ID…"
          hasActiveFilters={hasActiveFilters}
          onClear={() => { setQuery(''); setFrom(''); setTo(''); setTarget('all'); setActor('all'); setAction('all') }}
          options={options}
        />
        <div className={styles.resultMeta}>
          <strong>{loading ? '…' : data.total}</strong>
          <span>{data.total === 1 ? 'event' : 'events'}</span>
          {hasActiveFilters ? <span className={styles.filterHint}><OpsIcon name="filter" size={13} />Filtered view</span> : null}
        </div>
      </div>

      {error ? <div className="toast error" role="alert">{error}</div> : null}

      {!error && !loading && !data.items.length ? <div className={styles.empty}><span className={styles.emptyIcon}><OpsIcon name="search" size={20} /></span><strong>No matching audit events</strong><span>Try clearing a person, action, entity or date filter.</span></div> : null}

      <div className={styles.eventList} role="table" aria-label="Audit events">
        {data.items.map((log) => {
          const visual = auditVisual(log)
          return <article key={log.id} className={styles.eventCard} role="row">
            <button type="button" className={styles.eventButton} aria-expanded={expanded === log.id} onClick={() => setExpanded((current) => current === log.id ? null : log.id)}>
              <span className={`${styles.eventIcon} ${styles[visual.tone] ?? ''}`}><OpsIcon name={visual.icon} size={18} /></span>
              <span className={styles.eventCopy}>
                <span className={styles.eventTopline}><strong className={styles.eventTitle}>{humanizeAction(log.action)}</strong><span className={styles.entityBadge}>{targetLabel(log.targetType)}</span></span>
                <span className={styles.description}>{auditDescription(log)}</span>
                <span className={styles.context}><span><OpsIcon name="user" size={13} />{log.actorEmail}</span>{log.targetId ? <span className={styles.targetId}><OpsIcon name="review" size={13} />{log.targetId}</span> : null}</span>
              </span>
              <time className={styles.eventTime} dateTime={log.createdAt}><strong>{new Date(log.createdAt).toLocaleDateString('en-IE')}</strong><span>{new Date(log.createdAt).toLocaleTimeString('en-IE')}</span></time>
            </button>
            {expanded === log.id ? <div className={styles.details}><div className={styles.detailsHeader}><strong>Trace metadata</strong><span>Technical detail kept for governance and debugging</span></div><pre className={styles.metadata}>{formatMetadata(log.metadata)}</pre></div> : null}
          </article>
        })}
      </div>

      <PaginationControls page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} loading={loading} noun="events" onPageChange={setPage} />
    </section>
  </main>
}

function humanizeAction(action: string) {
  const overrides: Record<string, string> = {
    update_supply_status: 'Supply status updated',
    assign_supply: 'Supply owner assigned',
    create_supply: 'Supply request created',
    notify_supply_client: 'Client notified about supply request',
    admin_assist_workforce_scheduling_profile: 'Workforce profile updated by admin',
  }
  if (overrides[action]) return overrides[action]
  return action
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function targetLabel(targetType: string) {
  const labels: Record<string, string> = {
    supply: 'Supply request',
    user: 'User',
    membership: 'Access',
    site: 'Site',
    visit: 'Visit',
    operational_notice: 'Broadcast',
    communication: 'Communication',
    feedback: 'Feedback',
    time_entry: 'Time entry',
  }
  return labels[targetType] ?? targetType.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function auditVisual(log: AuditLog): { icon: OpsIconName; tone: 'default' | 'warning' | 'danger' | 'success' } {
  const action = log.action.toLowerCase()
  if (/(delete|remove|cancel|reject|revoke)/.test(action)) return { icon: 'alert', tone: 'danger' }
  if (/(create|invite|approve|deliver|complete)/.test(action)) return { icon: 'check', tone: 'success' }
  if (/(assign|status|reopen)/.test(action)) return { icon: 'activity', tone: 'warning' }
  if (/(notify|message|email|broadcast)/.test(action)) return { icon: 'message', tone: 'default' }
  if (log.targetType === 'supply') return { icon: 'box', tone: 'default' }
  if (log.targetType === 'site') return { icon: 'map', tone: 'default' }
  if (log.targetType === 'user' || log.targetType === 'membership') return { icon: 'user', tone: 'default' }
  return { icon: 'review', tone: 'default' }
}

function auditDescription(log: AuditLog) {
  const metadata = parseMetadata(log.metadata)
  const target = targetLabel(log.targetType).toLowerCase()
  if (log.action === 'update_supply_status') {
    const fromStatus = metadata?.fromStatus
    const toStatus = metadata?.status ?? metadata?.toStatus
    if (typeof fromStatus === 'string' && typeof toStatus === 'string') return `Changed the supply request from ${fromStatus} to ${toStatus}.`
    if (typeof toStatus === 'string') return `Changed the supply request status to ${toStatus}.`
  }
  const action = log.action.toLowerCase()
  if (action.includes('assign')) return `Changed responsibility or ownership for this ${target}.`
  if (/(create|invite|add)/.test(action)) return `Created or added this ${target}.`
  if (/(delete|remove|revoke)/.test(action)) return `Removed or revoked this ${target}.`
  if (/(notify|message|email|broadcast)/.test(action)) return `Sent a communication related to this ${target}.`
  if (/(update|edit|change|set)/.test(action)) return `Updated this ${target}.`
  return `Recorded “${humanizeAction(log.action)}” for this ${target}.`
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function formatMetadata(value: string | null) {
  if (!value) return 'No additional metadata was recorded for this event.'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}
