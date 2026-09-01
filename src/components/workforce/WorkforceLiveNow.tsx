'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import WorkforceLiveMap from './WorkforceLiveMap'
import WorkforceLiveIcon, { type WorkforceLiveIconName } from './WorkforceLiveIcon'
import type { LiveData, LiveEmployee, LiveFilter } from './live-types'
import styles from './WorkforceLiveNow.module.css'

const FILTERS: Array<{ value: LiveFilter; label: string; icon: WorkforceLiveIconName }> = [
  { value: 'all', label: 'All operational', icon: 'people' },
  { value: 'on_job', label: 'On job', icon: 'live' },
  { value: 'starting_soon', label: 'Starting soon', icon: 'clock' },
  { value: 'attention', label: 'Attention', icon: 'alert' },
  { value: 'expected_school', label: 'Expected school', icon: 'school' },
  { value: 'available', label: 'Available', icon: 'available' },
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

function stateIcon(employee: LiveEmployee): WorkforceLiveIconName {
  if (employee.attention || employee.state === 'attention') return 'alert'
  if (employee.state === 'on_job') return 'live'
  if (employee.state === 'starting_soon') return 'clock'
  if (employee.state === 'expected_school') return 'school'
  if (employee.state === 'available') return 'available'
  return 'people'
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
  if (employee.currentVisit) return `${employee.currentVisit.site.client.displayName} · ${employee.currentVisit.site.name}`
  if (employee.nextVisit) return `${formatTime(employee.nextVisit.scheduledStart, timezone)} · ${employee.nextVisit.site.name}`
  if (employee.state === 'expected_school') return employee.expectedContext.school?.label ?? 'Study schedule'
  if (employee.state === 'available') return 'Open capacity now'
  return employee.expectedContext.temporaryReason ?? 'Off operational map'
}

function mapSource(employee: LiveEmployee) {
  if (employee.mapPoint?.kind === 'live_gps') {
    return employee.signal.state === 'fresh'
      ? `Live work GPS · ${formatAge(employee.signal.ageSeconds)}`
      : `Last known work GPS · ${formatAge(employee.signal.ageSeconds)}`
  }
  if (employee.mapPoint?.kind === 'expected_visit_site') return 'Expected service site · not live GPS'
  if (employee.mapPoint?.kind === 'expected_school') return 'Expected school · study schedule'
  return 'Not mapped in Live now'
}

function scheduleHref(employee: LiveEmployee) {
  const visit = employee.currentVisit ?? employee.nextVisit
  const datePart = visit ? `&date=${encodeURIComponent(visit.scheduledStart)}` : ''
  return `/schedule?employee=${encodeURIComponent(employee.id)}${datePart}`
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
    <div className={styles.liveBar}>
      <div className={styles.liveMeta}>
        <span className={styles.liveBadge}><WorkforceLiveIcon name="live" /> Live</span>
        <span className={styles.updated} aria-live="polite">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · refreshes every 20s` : 'Connecting to live operations…'}
        </span>
      </div>
      <button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={loading}>
        <WorkforceLiveIcon name="refresh" />
        <span>Refresh</span>
      </button>
    </div>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}

    {data ? <>
      <div className={styles.metrics} aria-label="Live workforce summary">
        <button type="button" className={`${styles.metric} ${styles.metricOnJob} ${filter === 'on_job' ? styles.active : ''}`} onClick={() => chooseMetric('on_job')}>
          <WorkforceLiveIcon name="live" />
          <span><b>On job</b><small>Active timers</small></span>
          <strong>{data.summary.onJob}</strong>
        </button>
        <button type="button" className={`${styles.metric} ${styles.metricSoon} ${filter === 'starting_soon' ? styles.active : ''}`} onClick={() => chooseMetric('starting_soon')}>
          <WorkforceLiveIcon name="clock" />
          <span><b>Starting soon</b><small>Next 30 min</small></span>
          <strong>{data.summary.startingSoon}</strong>
        </button>
        <button type="button" className={`${styles.metric} ${styles.metricAttention} ${filter === 'attention' ? styles.active : ''}`} onClick={() => chooseMetric('attention')}>
          <WorkforceLiveIcon name="alert" />
          <span><b>Attention</b><small>Late, signal, incident</small></span>
          <strong>{data.summary.attention}</strong>
        </button>
        <button type="button" className={`${styles.metric} ${styles.metricSchool} ${filter === 'expected_school' ? styles.active : ''}`} onClick={() => chooseMetric('expected_school')}>
          <WorkforceLiveIcon name="school" />
          <span><b>Expected school</b><small>Schedule context</small></span>
          <strong>{data.summary.expectedSchool}</strong>
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label="Live status filters">
          {FILTERS.map((item) => <button key={item.value} type="button" className={filter === item.value ? styles.active : ''} onClick={() => { setFilter(item.value); setSelectedId('') }}>
            <WorkforceLiveIcon name={item.icon} />
            <span>{item.label}</span>
          </button>)}
        </div>
        <label className={styles.searchBox}>
          <WorkforceLiveIcon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search person, site or school" aria-label="Search live team" />
        </label>
      </div>

      <div className={styles.layout}>
        <section className={styles.mapCard}>
          <header className={styles.mapHeader}>
            <div><h2>Live operations map</h2><p>Live GPS, expected service sites and school context are intentionally shown as different sources.</p></div>
            <span className={styles.updated}>{mapEmployees.length} mapped</span>
          </header>
          <WorkforceLiveMap employees={mapEmployees} selectedId={selectedId} onSelect={(employee) => setSelectedId(employee.id)} />
          <div className={styles.privacy}>Work GPS appears only from an active visit timer. Stale GPS is labelled last known. Home remains a planning origin in Plan ahead.</div>
        </section>

        <aside className={styles.activityCard}>
          {selected ? <>
            <header className={styles.detailHeader}>
              <button type="button" className={styles.backButton} onClick={() => setSelectedId('')}>
                <WorkforceLiveIcon name="back" />
                <span>Back to team</span>
              </button>
              <span className={`${styles.state} ${stateClass(selected)}`}><WorkforceLiveIcon name={stateIcon(selected)} />{stateLabel(selected)}</span>
            </header>
            <div className={styles.detail}>
              <div className={styles.detailIdentity}>
                <span className={`${styles.avatar} ${stateClass(selected)}`}>{initials(selected.name)}</span>
                <div><h3>{selected.name}</h3><p>{selected.email}</p></div>
              </div>

              {selected.attentionReason ? <div className={styles.notice}><WorkforceLiveIcon name="alert" /><span>{selected.attentionReason}</span></div> : null}
              {selected.criticalIncident ? <div className={styles.notice}><WorkforceLiveIcon name="alert" /><span><strong>{selected.criticalIncident.title}</strong><br />Open critical incident on the active visit.</span></div> : null}

              <div className={styles.detailFacts}>
                <div className={styles.detailFact}><span className={styles.factIcon}><WorkforceLiveIcon name={stateIcon(selected)} /></span><div><span>Operational state</span><strong>{stateLabel(selected)}</strong></div></div>
                <div className={styles.detailFact}><span className={styles.factIcon}><WorkforceLiveIcon name="clock" /></span><div><span>Timer</span><strong>{selected.timer ? timerDuration(selected.timer.startedAt, clock) : 'Not running'}</strong></div></div>
                <div className={styles.detailFact}><span className={styles.factIcon}><WorkforceLiveIcon name="signal" /></span><div><span>Signal</span><strong className={selected.signal.state === 'fresh' ? styles.signalFresh : selected.signal.state === 'stale' ? styles.signalStale : selected.signal.state === 'missing' ? styles.signalMissing : ''}>{selected.signal.state === 'not_expected' ? 'Not expected' : `${selected.signal.state} · ${formatAge(selected.signal.ageSeconds)}`}</strong></div></div>
                <div className={styles.detailFact}><span className={styles.factIcon}><WorkforceLiveIcon name="map" /></span><div><span>Map source</span><strong>{mapSource(selected)}</strong></div></div>
                <div className={styles.detailFact}><span className={styles.factIcon}><WorkforceLiveIcon name="location" /></span><div><span>Location check</span><strong>{selected.signal.classification ? selected.signal.classification.replaceAll('_', ' ') : 'Not required'}{selected.signal.distanceM != null ? ` · ${selected.signal.distanceM}m from site` : ''}</strong></div></div>
              </div>

              {selected.currentVisit ? <div className={styles.visitContext}>
                <WorkforceLiveIcon name="visit" />
                <div><span>Active visit</span><strong>{selected.currentVisit.site.client.displayName} · {selected.currentVisit.site.name}</strong><small>{formatTime(selected.currentVisit.scheduledStart, data.timezone)}–{formatTime(selected.currentVisit.scheduledEnd, data.timezone)} · {selected.currentVisit.site.addressLine1}, {selected.currentVisit.site.city}</small></div>
              </div> : selected.nextVisit ? <div className={styles.visitContext}>
                <WorkforceLiveIcon name="clock" />
                <div><span>Next visit</span><strong>{selected.nextVisit.site.client.displayName} · {selected.nextVisit.site.name}</strong><small>Starts {formatTime(selected.nextVisit.scheduledStart, data.timezone)}</small></div>
              </div> : selected.state === 'expected_school' ? <div className={styles.visitContext}>
                <WorkforceLiveIcon name="school" />
                <div><span>Expected context</span><strong>{selected.expectedContext.school?.label ?? 'School'}</strong><small>Based on the registered study schedule, not a live location.</small></div>
              </div> : <div className={styles.visitContext}>
                <WorkforceLiveIcon name="available" />
                <div><span>Capacity now</span><strong>Available for operational planning</strong><small>No active or imminent visit in the live window.</small></div>
              </div>}

              <div className={styles.actions}>
                {(selected.currentVisit ?? selected.nextVisit) ? <a className={styles.primaryAction} href={`/schedule?visit=${(selected.currentVisit ?? selected.nextVisit)!.id}`}><WorkforceLiveIcon name="visit" />Open visit</a> : null}
                <a href={scheduleHref(selected)}><WorkforceLiveIcon name="calendar" />Open schedule</a>
                {selected.timer ? <a href="/field-control"><WorkforceLiveIcon name="location" />Field Control</a> : null}
              </div>
            </div>
          </> : <>
            <header className={styles.activityHeader}>
              <div><h2>Team activity</h2><p>{employees.length} in this view · {data.summary.unavailable} unavailable/off-map</p></div>
              <span className={styles.teamCount}>{employees.length}</span>
            </header>
            <div className={styles.activityList}>
              {employees.map((employee) => <button type="button" key={employee.id} className={`${styles.person} ${selectedId === employee.id ? styles.selected : ''}`} onClick={() => setSelectedId(employee.id)}>
                <span className={`${styles.avatar} ${stateClass(employee)}`}>{initials(employee.name)}</span>
                <span className={styles.personMain}>
                  <strong>{employee.name}</strong>
                  <small>{secondaryLine(employee, data.timezone)}</small>
                  {employee.state === 'on_job' ? <small>{employee.signal.classification ? `${employee.signal.classification.replaceAll('_', ' ')} · ` : ''}{formatAge(employee.signal.ageSeconds)}</small> : null}
                </span>
                <span className={`${styles.state} ${stateClass(employee)}`}><WorkforceLiveIcon name={stateIcon(employee)} />{employee.attention && employee.state === 'on_job' ? 'Attention' : stateLabel(employee)}</span>
              </button>)}
              {!employees.length ? <div className={styles.empty}>No team members match this live view.</div> : null}
            </div>
          </>}
        </aside>
      </div>
    </> : loading ? <div className={styles.loading}>Building live operations picture…</div> : null}
  </section>
}
