'use client'

import { useEffect, useState } from 'react'
import styles from './EmployeeScheduleSummary.module.css'

type Summary = {
  employee: { id: string; name: string | null; email: string }
  booked: { visits: number; minutes: number }
  confirmed: { visits: number; minutes: number }
  done: { visits: number; minutes: number }
}

async function loadSummary(employeeId: string, from: string, to: string) {
  const params = new URLSearchParams({ employeeId, from, to })
  const response = await fetch(`/api/schedule-employee-summary?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Could not load employee hours.')
  return body.data as Summary
}

function hours(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

export default function EmployeeScheduleSummary({ employeeId, from, to, refreshSignal }: { employeeId: string; from: string; to: string; refreshSignal: number }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setError(null)
    void loadSummary(employeeId, from, to)
      .then((value) => { if (active) setSummary(value) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load employee hours.') })
    return () => { active = false }
  }, [employeeId, from, refreshSignal, to])

  if (error) return <div className={styles.error} role="status">Employee hour totals are temporarily unavailable.</div>
  if (!summary) return <div className={styles.loading}>Loading employee hours…</div>

  const name = summary.employee.name ?? summary.employee.email
  return <section className={styles.summary} aria-label={`${name} schedule hours`}>
    <div className={styles.identity}><span>Selected employee</span><strong>{name}</strong><small>Planned hours for future work · recorded visit time for Done</small></div>
    <div className={styles.metric}><span>Booked</span><strong>{hours(summary.booked.minutes)}</strong><small>{summary.booked.visits} visit{summary.booked.visits === 1 ? '' : 's'} awaiting confirmation</small></div>
    <div className={styles.metric}><span>Confirmed</span><strong>{hours(summary.confirmed.minutes)}</strong><small>{summary.confirmed.visits} accepted / active visit{summary.confirmed.visits === 1 ? '' : 's'}</small></div>
    <div className={styles.metric}><span>Done</span><strong>{hours(summary.done.minutes)}</strong><small>{summary.done.visits} completed visit{summary.done.visits === 1 ? '' : 's'} · recorded time</small></div>
  </section>
}
