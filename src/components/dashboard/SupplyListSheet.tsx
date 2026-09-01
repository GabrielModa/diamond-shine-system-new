'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { timeAgo } from '../../lib/business-logic'
import { isSupplyOverdue } from '../../lib/business-logic'
import { useDialogFocus } from './useDialogFocus'
import ListControls from '../ui/ListControls'

type ListFilter = {
  priority?: SupplyPriority
  status?: SupplyStatus
}

type ListPreset = {
  period?: 'all' | '7' | '30' | '90' | 'month'
  location?: string
  employee?: string
  search?: string
  overdue?: boolean
  unassigned?: boolean
}

type SupplyListSheetProps = {
  open: boolean
  active: boolean
  title: string
  requests: SupplyRequest[]
  filter: ListFilter
  preset?: ListPreset
  onClose: () => void
  onSelect: (request: SupplyRequest) => void
  onSendEmail: (request: SupplyRequest) => void
}

export function SupplyListSheet({
  open,
  active,
  title,
  requests,
  filter,
  preset,
  onClose,
  onSelect,
  onSendEmail,
}: SupplyListSheetProps) {
  const dialogRef = useDialogFocus(active, onClose)
  const [period, setPeriod] = useState('all')
  const [location, setLocation] = useState('all')
  const [employee, setEmployee] = useState('all')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [applied, setApplied] = useState({
    period: 'all',
    location: 'all',
    employee: 'all',
    search: '',
  })
  const [searchDebounced, setSearchDebounced] = useState('')
  const presetPeriod = preset?.period
  const presetLocation = preset?.location
  const presetEmployee = preset?.employee
  const presetSearch = preset?.search

  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (searchDebounced !== applied.search) {
      setApplied((prev) => ({ ...prev, search: searchDebounced }))
    }
  }, [searchDebounced, applied.search])

  useEffect(() => {
    if (!open) {
      setPeriod('all')
      setLocation('all')
      setEmployee('all')
      setSearch('')
      setApplied({ period: 'all', location: 'all', employee: 'all', search: '' })
    }
  }, [open])

  useEffect(() => {
    if (!open || !preset) return
    const next = {
      period: presetPeriod ?? 'all',
      location: presetLocation ?? 'all',
      employee: presetEmployee ?? 'all',
      search: presetSearch ?? '',
    }
    setPeriod(next.period)
    setLocation(next.location)
    setEmployee(next.employee)
    setSearch(next.search)
    setApplied(next)
  }, [open, preset, presetEmployee, presetLocation, presetPeriod, presetSearch])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 720px)')
    const apply = () => {
      setIsMobile(mq.matches)
      setFiltersOpen(!mq.matches)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const filtered = useMemo(() => {
    let list = requests

    if (filter.priority) list = list.filter((item) => item.priority === filter.priority)
    if (filter.status) list = list.filter((item) => item.status === filter.status)
    if (preset?.overdue) list = list.filter((item) => isSupplyOverdue(item.dueAt, item.status))
    if (preset?.unassigned) list = list.filter((item) => !item.assignedTo && !['Delivered', 'Rejected', 'Cancelled'].includes(item.status))

    const now = new Date()
    if (applied.period !== 'all') {
      if (applied.period === 'month') {
        const currentMonth = now.getMonth()
        const currentYear = now.getFullYear()
        list = list.filter((item) => {
          const date = new Date(item.createdAt)
          return date.getMonth() === currentMonth && date.getFullYear() === currentYear
        })
      } else {
        const days = Number(applied.period)
        list = list.filter((item) => {
          const diff = now.getTime() - new Date(item.createdAt).getTime()
          return diff <= days * 24 * 60 * 60 * 1000
        })
      }
    }
    if (applied.location !== 'all') list = list.filter((item) => item.clientLocation === applied.location)
    if (applied.employee !== 'all') list = list.filter((item) => item.employeeName === applied.employee)
    if (applied.search.trim()) {
      const query = applied.search.trim().toLowerCase()
      list = list.filter(
        (item) =>
          item.employeeName.toLowerCase().includes(query) ||
          item.clientLocation.toLowerCase().includes(query) ||
          item.products.join(', ').toLowerCase().includes(query)
      )
    }

    return list
  }, [requests, filter, applied, preset?.overdue, preset?.unassigned])

  const employees = useMemo(() => {
    return Array.from(new Set(requests.map((item) => item.employeeName))).sort()
  }, [requests])

  const locations = useMemo(() => {
    return Array.from(new Set(requests.map((item) => item.clientLocation))).sort()
  }, [requests])

  return (
    <div
      id="listOverlay"
      className={`overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-hidden={!active}
    >
      <div ref={dialogRef} tabIndex={-1} className="overlay-sheet list-sheet fade-up" role="dialog" aria-modal="true" aria-labelledby="supply-list-title">
        <div className="sheet-header">
          <h2 id="supply-list-title">
            <span className="title-icon">📋</span>
            {title}
          </h2>
          <span className="count-pill">{filtered.length}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-subtitle">Filter and manage supply requests</div>

        <div className="supply-standard-filter"><ListControls query={applied.search} onQueryChange={(value) => setApplied((current) => ({ ...current, search: value }))} placeholder="Search supply requests…" hasActiveFilters={Boolean(applied.search || applied.period !== 'all' || applied.location !== 'all' || applied.employee !== 'all')} onClear={() => setApplied({ period: 'all', location: 'all', employee: 'all', search: '' })} options={[{ label: 'Period', value: applied.period, defaultValue: 'all', choices: [{ value: 'all', label: 'All time' }, { value: 'month', label: 'This month' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }], onChange: (value) => setApplied((current) => ({ ...current, period: value })) }, { label: 'Location', value: applied.location, defaultValue: 'all', choices: [{ value: 'all', label: 'All locations' }, ...locations.map((value) => ({ value, label: value }))], onChange: (value) => setApplied((current) => ({ ...current, location: value })) }, { label: 'Employee', value: applied.employee, defaultValue: 'all', choices: [{ value: 'all', label: 'All employees' }, ...employees.map((value) => ({ value, label: value }))], onChange: (value) => setApplied((current) => ({ ...current, employee: value })) }]} /></div>

        <div className="filters-compact">
          <input
            type="search"
            aria-label="Search supply requests"
            placeholder="Search requests..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="button" className="btn-ghost" onClick={() => setFiltersOpen((prev) => !prev)}>
            {filtersOpen ? 'Hide filters' : 'Filters'}
          </button>
        </div>

        {!isMobile || filtersOpen ? (
          <div className="filters card">
            <div className="filters-grid">
              <select aria-label="Filter by period" value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option value="all">All time</option>
                <option value="month">This month</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <select aria-label="Filter by location" value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="all">All locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by employee" value={employee} onChange={(event) => setEmployee(event.target.value)}>
                <option value="all">All employees</option>
                {employees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                type="search"
                aria-label="Search supply requests"
                placeholder="Search requests..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="row tight action-row">
              <button
                type="button"
                className="btn-primary"
                onClick={() =>
                  setApplied({
                    period,
                    location,
                    employee,
                    search,
                  })
                }
              >
                Apply
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setPeriod('all')
                  setLocation('all')
                  setEmployee('all')
                  setSearch('')
                  setApplied({ period: 'all', location: 'all', employee: 'all', search: '' })
                }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        <div className="list-results">
          {filtered.length === 0 ? (
            <div className="empty-state">No requests found.</div>
          ) : null}
          {filtered.map((item) => (
            <div key={item.id} className="list-item">
              <button type="button" className="list-open-button" onClick={() => onSelect(item)} aria-label={`Open request from ${item.employeeName} at ${item.clientLocation}`}>
              <span className="list-main">
                <span className="list-title">{item.employeeName}</span>
                <span className="muted">{item.clientLocation}</span>
              </span>
              <span className="list-meta">
                <span className={`status-badge ${item.status.replace(' ', '-')}`}>
                  {item.status === 'Requested' ? '🆕' : item.status === 'In transit' ? '🚚' : item.status === 'Cancelled' || item.status === 'Rejected' ? '⛔' : item.status === 'Delivered' ? '✅' : '⏳'} {item.status}
                </span>
                <span className={`badge ${item.priority}`}>
                  {item.priority === 'urgent' ? '🔴' : item.priority === 'normal' ? '🟡' : '🟢'}{' '}
                  {item.priority.toUpperCase()}
                </span>
                <span className="muted">{timeAgo(item.createdAt)}</span>
              </span>
              </button>
              <div className="list-actions">
                {!['Delivered', 'Rejected', 'Cancelled'].includes(item.status) ? (
                  <button
                    title="Send Email"
                    aria-label={`Send email for ${item.employeeName}'s request`}
                    className="btn-success"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSendEmail(item)
                    }}
                  >
                    📧
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
