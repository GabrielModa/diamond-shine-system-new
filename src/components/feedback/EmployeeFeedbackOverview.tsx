'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeedbackCategory } from '../../types'
import OpsIcon from '../ui/OpsIcon'
import PaginationControls from '../ui/PaginationControls'
import styles from './ServiceFeedbackWorkspace.module.css'

export type EmployeeFeedbackSummary = {
  name: string
  evaluations: number
  overall: number
  category: FeedbackCategory
  cleanliness: number
  punctuality: number
  equipment: number
  clientRelations: number
  latestLocation: string | null
  latestAt: string | null
}

export type FeedbackTrend = {
  currentCount: number
  previousCount: number
  currentAverage: number | null
  previousAverage: number | null
  delta: number | null
}

const CATEGORIES: Array<'all' | FeedbackCategory> = ['all', 'Excellent', 'Very Good', 'Good', 'Fair', 'Poor']
const EMPLOYEE_PAGE_SIZE = 8

export default function EmployeeFeedbackOverview({
  employees,
  totalEvaluations,
  attention,
  average,
  trend,
  onEmployee,
  onHistory,
}: {
  employees: EmployeeFeedbackSummary[]
  totalEvaluations: number
  attention: number
  average: number
  trend: FeedbackTrend
  onEmployee: (name: string) => void
  onHistory: () => void
}) {
  const [category, setCategory] = useState<'all' | FeedbackCategory>('all')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [page, setPage] = useState(1)
  const listRef = useRef<HTMLDivElement | null>(null)
  const filtered = useMemo(
    () => employees.filter((employee) =>
      (category === 'all' || employee.category === category)
      && (!attentionOnly || employee.overall < 4),
    ),
    [attentionOnly, category, employees],
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE))
  const visibleEmployees = filtered.slice((page - 1) * EMPLOYEE_PAGE_SIZE, page * EMPLOYEE_PAGE_SIZE)
  useEffect(() => {
    setPage(1)
    listRef.current?.scrollTo({ top: 0 })
  }, [attentionOnly, category])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  return <section className={styles.performancePanel} aria-labelledby="employee-feedback-title">
    <div className={styles.performanceHead}>
      <div className={styles.iconHeading}>
        <span className={styles.iconTile}><OpsIcon name="star" size={19} /></span>
        <div><span className="eyebrow">Employee ratings</span><h2 id="employee-feedback-title">Service performance by employee</h2><p>Scan performance here, then open the exact evaluations only when you need them.</p></div>
      </div>
      <button type="button" className="btn-secondary" onClick={onHistory}><OpsIcon name="review" size={16} /> Feedback history</button>
    </div>

    <div className={styles.performanceMetrics}>
      <article><OpsIcon name="user" /><span>Rated employees</span><strong>{employees.length}</strong></article>
      <article><OpsIcon name="review" /><span>Evaluations</span><strong>{totalEvaluations}</strong></article>
      <article><OpsIcon name="star" /><span>Average rating</span><strong>{average ? average.toFixed(1) : '—'}</strong></article>
      <button type="button" className={`${styles.metricButton} ${attention ? styles.metricAttention : ''} ${attentionOnly ? styles.metricSelected : ''}`} aria-pressed={attentionOnly} onClick={() => setAttentionOnly((current) => !current)}><OpsIcon name="alert" /><span>Needs attention</span><strong>{attention}</strong><small>{attentionOnly ? 'Showing employees below 4.0' : 'Click to filter employees below 4.0'}</small></button>
      <article><OpsIcon name="trend" /><span>30-day trend</span><strong>{trend.delta == null ? '—' : (trend.delta >= 0 ? '+' : '') + trend.delta.toFixed(1)}</strong><small>{trend.currentCount} recent evaluations</small></article>
    </div>

    <div className={styles.ratingPills} role="group" aria-label="Filter employees by rating">
      {CATEGORIES.map((item) => <button type="button" key={item} className={category === item ? styles.selected : ''} aria-pressed={category === item} onClick={() => { setCategory(item); setAttentionOnly(false) }}>
        {item === 'all' ? 'All ratings' : item}
      </button>)}
    </div>

    <div ref={listRef} className={styles.employeeViewport} data-testid="feedback-employee-viewport">
      <div className={styles.employeeList}>
        {visibleEmployees.map((employee) => <button type="button" key={employee.name} className={styles.employeeRow} onClick={() => onEmployee(employee.name)}>
          <div className={styles.employeeIdentity}>
            <strong>{employee.name}</strong>
            <span>{employee.latestLocation ?? 'No recent location'}{employee.latestAt ? ' · ' + new Date(employee.latestAt).toLocaleDateString('en-IE') : ''}</span>
          </div>
          <span className={`${styles.categoryChip} ${employee.overall < 4 ? styles.categoryAttention : ''}`}>{employee.category}</span>
          <div className={styles.dimensionGrid} aria-label={employee.name + ' rating dimensions'}>
            <span>Clean <b>{employee.cleanliness.toFixed(1)}</b></span>
            <span>Time <b>{employee.punctuality.toFixed(1)}</b></span>
            <span>Equip <b>{employee.equipment.toFixed(1)}</b></span>
            <span>Client <b>{employee.clientRelations.toFixed(1)}</b></span>
          </div>
          <div className={styles.employeeScore}><strong>{employee.overall.toFixed(1)}</strong><small>{employee.evaluations} eval.</small></div>
          <span className={styles.rowArrow} aria-hidden="true">→</span>
        </button>)}
        {!filtered.length ? <div className="empty-state compact">No employees match this performance filter.</div> : null}
      </div>
    </div>
    <PaginationControls page={page} totalPages={totalPages} total={filtered.length} limit={EMPLOYEE_PAGE_SIZE} noun="employees" onPageChange={(next) => { setPage(next); listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }} className={styles.employeePagination} />
  </section>
}
