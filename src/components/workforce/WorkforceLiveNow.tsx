'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import WorkforceLiveMap from './WorkforceLiveMap'
import type { LiveData, LiveEmployee, LiveFilter } from './live-types'
import styles from './WorkforceLiveNow.module.css'

const FILTERS: Array<{ value: LiveFilter; label: string }> = [
  { value: 'all', label: 'All operational' },
  { value: 'on_job', label: 'On job' },
  { value: 'starting_soon', label: 'Starting soon' },
  { value: 'attention', label: 'Attention' },
  { value: 'expected_school', label: 'Expected school' },
  { value: 'available', label: 'Available' },
]

function stateLabel(employee: LiveEmployee) {
  if (employee.state === 'on_job') return 'On job'
  if (employee.state === 'starting_soon') return 'Starting soon'
  if (employee.state === 'attention') return 'Needs attention'
  if (employee.state === 'expected_school') return 'Expected school'
  if (employee.state === 'available') return 'Available'
  return 'Unavailable'
}

function stateClass(employee: LiveEmployee) {
  if (employee.attention || employee.state === 'attention') return styles.attentionState
  return styles[employee.state] ?? styles.available
}

function initials(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function formatTime(value: string | null | undefined, timezone: string) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-IE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAge(seconds: number | null) {
  if (seconds == null) return 'No recent signal'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes} min ago`
}

function timerDuration(startedAt: string | null, now: number) {
  if (!startedAt) return '—'
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}h ${rest}m` : `${rest}m`
}

function secondaryLine(employee: LiveEmployee, timezone: string) {
  if (employee.currentVisit) {
    return `${employee.currentVisit.site.client.displayName} · ${employee.currentVisit.site.name}`
  }
  if (employee.nextVisit) {
    return `${formatTime(employee.nextVisit.scheduledStart, timezone)} · ${employee.nextVisit.site.name}`
  }
  if (employee.state === 'expected_school') {
    return employee.expectedContext.school?.label ?? 'Study schedule'
  }
  if (employee.state === 'available') return 'No active visit'
  return employee.expectedContext.temporaryReason ?? 'Off operational map'
}

function mapSource(employee: LiveEmployee) {
  if (employee.mapPoint?.kind === 'live_gps') {
    return employee.signal.state === 'fresh' ? `Live work GPS · ${formatAge(employee.signal.ageSeconds)}` : `Last known work GPS · ${formatAge(employee.signal.ageSeconds)}`
  }
  if (employee.mapPoint?.kind === 'expected_visit_site') return 'Expected service site · not live GPS'
  if (employee.mapPoint?.kind === 'expected_school') return 'Expected school · study schedule'
  return 'Not mapped in Live now'
}

export default function WorkforceLiveNow() {
  const [data, setData] = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<LiveFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [clock, setClock] = useState(() => Date.now())

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/workforce/live', { cache: 'no-store', credentials: 'include' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load live workforce status.')
      setData(body.data as LiveData)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load live workforce status.')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(true), 20_000)
    const onFocus = () => void refresh(true)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const employees = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rank: Record<LiveEmployee['state'], number> = {
      attention: 0,
      on_job: 1,
      starting_soon: 2,
      expected_school: 3,
      available: 4,
      unavailable: 5,
    }
    return [...(data?.employees ?? [])]
      .filter((employee) => employee.state !== 'unavailable')
      .filter((employee) => {
        if (!needle) return true
        return `${employee.name} ${employee.email} ${employee.currentVisit?.site.name ?? ''} ${employee.currentVisit?.site.client.displayName ?? ''} ${employee.nextVisit?.site.name ?? ''} ${employee.expectedContext.school?.label ?? ''}`
          .toLowerCase().includes(needle)
      })
      .filter((employee) => {
        if (filter === 'all') return true
        if (filter === 'attention') return employee.attention || employee.state === 'attention'
        return employee.state === filter
      })
      .sort((a, b) => {
        const attentionA = a.attention || a.state === 'attention' ? -10 : 0
        const attentionB = b.attention || b.state === 'attention' ? -10 : 0
        return attentionA + rank[a.state] - (attentionB + rank[b.state]) || a.name.localeCompare(b.name)
      })
  }, [data, filter, query])

  const selected = useMemo(() => data?.employees.find((employee) => employee.id === selectedId) ?? null, [data, selectedId])
  const mapEmployees = employees.filter((employee) => employee.mapPoint)
  const updatedAt = data?.generatedAt ? new Date(data.generatedAt) : null

  function chooseMetric(next: LiveFilter) {
    setFilter((current) => current === next ? 'all' : next)
    setSelectedId('')
  }

  return <section className={styles.shell}>
    <div className={styles.topline}>
      <div>
        <strong>Live operational picture</strong>
        <div className={styles.updated} aria-live="polite">
          {updatedAt ? `Server snapshot ${updatedAt.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh every 20s` : 'Connecting to live operations…'}
        </div>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={loading}>↻ Refresh now</button>
    </div>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}

    {data ? <>
      <div className={styles.metrics} aria-label="Live workforce summary">
        <button type="button" className={`${styles.metric} ${filter === 'on_job' ? styles.active : ''}`} onClick={() => chooseMetric('on_job')}>
          <span>On job</span><strong>{data.summary.onJob}</strong><small>Active visit timers</small>
        </button>
        <button type="button" className={`${styles.metric} ${filter === 'starting_soon' ? styles.active : ''}`} onClick={() => chooseMetric('starting_soon')}>
          <span>Starting soon</span><strong>{data.summary.startingSoon}</strong><small>Next 30 minutes</small>
        </button>
        <button type="button" className={`${styles.metric} ${styles.attention} ${filter === 'attention' ? styles.active : ''}`} onClick={() => chooseMetric('attention')}>
          <span>Attention</span><strong>{data.summary.attention}</strong><small>Late, signal or incident</small>
        </button>
        <button type="button" className={`${styles.metric} ${filter === 'expected_school' ? styles.active : ''}`} onClick={() => chooseMetric('expected_school')}>
          <span>Expected school</span><strong>{data.summary.expectedSchool}</strong><small>Schedule context, not live position</small>
        </button>
      </div>

      <div className={styles.topline}>
        <div className={styles.filters} aria-label="Live status filters">
          {FILTERS.map((item) => <button key={item.value} type="button" className={filter === item.value ? styles.active : ''} onClick={() => { setFilter(item.value); setSelectedId('') }}>{item.label}</button>)}
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, site or school…" aria-label="Search live team" />
      </div>

      <div className={styles.layout}>
        <section className={styles.mapCard}>
          <header className={styles.mapHeader}>
            <div><h2>Live operations map</h2><p>Active work uses the latest work-session GPS when available. Expected visit and school positions are shown separately and never presented as live GPS.</p></div>
            <span className={styles.updated}>{mapEmployees.length} mapped</span>
          </header>
          <WorkforceLiveMap employees={mapEmployees} selectedId={selectedId} onSelect={(employee) => setSelectedId(employee.id)} />
          <div className={styles.privacy}>Work GPS is surfaced only from an active visit timer. A stale signal remains visible only as last known work GPS. Home stays in Plan ahead.</div>
        </section>

        <aside className={styles.activityCard}>
          <header className={styles.activityHeader}>
            <div><h2>Team activity</h2><p>{employees.length} operational team member{employees.length === 1 ? '' : 's'} in this view · {data.summary.unavailable} off-map</p></div>
          </header>
          <div className={styles.activityList}>
            {employees.map((employee) => <button type="button" key={employee.id} className={`${styles.person} ${selectedId === employee.id ? styles.selected : ''}`} onClick={() => setSelectedId(employee.id)}>
              <span className={styles.avatar}>{initials(employee.name)}</span>
              <span className={styles.personMain}>
                <strong>{employee.name}</strong>
                <small>{secondaryLine(employee, data.timezone)}</small>
                {employee.state === 'on_job' ? <small>{employee.signal.classification ? `${employee.signal.classification.replaceAll('_', ' ')} · ` : ''}{formatAge(employee.signal.ageSeconds)}</small> : null}
              </span>
              <span className={`${styles.state} ${stateClass(employee)}`}>{employee.attention && employee.state === 'on_job' ? 'On job · attention' : stateLabel(employee)}</span>
            </button>)}
            {!employees.length ? <div className={styles.empty}>No team members match this live view.</div> : null}
          </div>

          {selected ? <div className={styles.detail}>
            <div className={styles.detailTitle}><div><h3>{selected.name}</h3><span className={`${styles.state} ${stateClass(selected)}`}>{stateLabel(selected)}</span></div><button type="button" aria-label="Close live person detail" onClick={() => setSelectedId('')}>×</button></div>
            {selected.attentionReason ? <div className={styles.notice}>{selected.attentionReason}</div> : null}
            {selected.criticalIncident ? <div className={styles.notice}><strong>{selected.criticalIncident.title}</strong><br />Open critical incident on the active visit.</div> : null}
            <div className={styles.detailGrid}>
              <div><span>Operational state</span><strong>{stateLabel(selected)}</strong></div>
              <div><span>Timer</span><strong>{selected.timer ? timerDuration(selected.timer.startedAt, clock) : 'Not running'}</strong></div>
              <div><span>Signal</span><strong className={selected.signal.state === 'fresh' ? styles.signalFresh : selected.signal.state === 'stale' ? styles.signalStale : selected.signal.state === 'missing' ? styles.signalMissing : ''}>{selected.signal.state === 'not_expected' ? 'Not expected' : `${selected.signal.state} · ${formatAge(selected.signal.ageSeconds)}`}</strong></div>
              <div><span>Map source</span><strong>{mapSource(selected)}</strong></div>
              <div><span>Location check</span><strong>{selected.signal.classification ? selected.signal.classification.replaceAll('_', ' ') : '—'}{selected.signal.distanceM != null ? ` · ${selected.signal.distanceM}m from site` : ''}</strong></div>
            </div>
            {selected.currentVisit ? <div>
              <strong>{selected.currentVisit.site.client.displayName} · {selected.currentVisit.site.name}</strong>
              <div className={styles.updated}>{formatTime(selected.currentVisit.scheduledStart, data.timezone)}–{formatTime(selected.currentVisit.scheduledEnd, data.timezone)} · {selected.currentVisit.site.addressLine1}, {selected.currentVisit.site.city}</div>
            </div> : selected.nextVisit ? <div>
              <strong>Next · {selected.nextVisit.site.client.displayName} · {selected.nextVisit.site.name}</strong>
              <div className={styles.updated}>Starts {formatTime(selected.nextVisit.scheduledStart, data.timezone)}</div>
            </div> : selected.state === 'expected_school' ? <div><strong>Expected at {selected.expectedContext.school?.label ?? 'school'}</strong><div className={styles.updated}>Based on the registered study schedule, not a live location.</div></div> : null}
            <div className={styles.actions}>
              {(selected.currentVisit ?? selected.nextVisit) ? <a href={`/schedule?visit=${(selected.currentVisit ?? selected.nextVisit)!.id}`}>Open visit</a> : null}
              {selected.timer ? <a href="/field-control">Open Field Control</a> : null}
              <a href="/schedule">Open Schedule</a>
            </div>
          </div> : null}
        </aside>
      </div>
    </> : loading ? <div className={styles.loading}>Building live operations picture…</div> : null}
  </section>
}
