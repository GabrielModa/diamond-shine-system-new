'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { timeAgo } from '../../lib/business-logic'

type ListFilter = {
  priority?: SupplyPriority
  status?: SupplyStatus
}

type ListPreset = {
  period?: 'all' | '7' | '30' | '90' | 'month'
  location?: string
  employee?: string
  search?: string
}

type SupplyListSheetProps = {
  open: boolean
  title: string
  requests: SupplyRequest[]
  filter: ListFilter
  preset?: ListPreset
  onClose: () => void
  onSelect: (request: SupplyRequest) => void
  onSendEmail: (request: SupplyRequest) => void
  onMarkComplete: (request: SupplyRequest) => void
}

export function SupplyListSheet({
  open,
  title,
  requests,
  filter,
  preset,
  onClose,
  onSelect,
  onSendEmail,
  onMarkComplete,
}: SupplyListSheetProps) {
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
  const presetKey = `${preset?.period ?? ''}|${preset?.location ?? ''}|${preset?.employee ?? ''}|${preset?.search ?? ''}`

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
      period: preset.period ?? 'all',
      location: preset.location ?? 'all',
      employee: preset.employee ?? 'all',
      search: preset.search ?? '',
    }
    setPeriod(next.period)
    setLocation(next.location)
    setEmployee(next.employee)
    setSearch(next.search)
    setApplied(next)
  }, [open, presetKey])

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
  }, [requests, filter, applied])

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
    >
      <div className="overlay-sheet list-sheet fade-up">
        <div className="sheet-header">
          <h2>
            <span className="title-icon">📋</span>
            {title}
          </h2>
          <span className="count-pill">{filtered.length}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-subtitle">Filter and manage supply requests</div>

        <div className="filters-compact">
          <input
            type="search"
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
              <select value={period} onChange={(event) => setPeriod(event.target.value)}>
                <option value="all">All time</option>
                <option value="month">This month</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
              <select value={location} onChange={(event) => setLocation(event.target.value)}>
                <option value="all">All locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <select value={employee} onChange={(event) => setEmployee(event.target.value)}>
                <option value="all">All employees</option>
                {employees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                type="search"
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
            <div key={item.id} className="list-item" onClick={() => onSelect(item)}>
              <div className="list-main">
                <div className="list-title">{item.employeeName}</div>
                <div className="muted">{item.clientLocation}</div>
              </div>
              <div className="list-meta">
                <span className={`status-badge ${item.status.replace(' ', '-')}`}>
                  {item.status === 'Pending' ? '⏳' : item.status === 'Email Sent' ? '📧' : '✅'} {item.status}
                </span>
                <span className={`badge ${item.priority}`}>
                  {item.priority === 'urgent' ? '🔴' : item.priority === 'normal' ? '🟡' : '🟢'}{' '}
                  {item.priority.toUpperCase()}
                </span>
                <span className="muted">{timeAgo(item.createdAt)}</span>
              </div>
              <div className="list-actions">
                {item.status === 'Pending' ? (
                  <button
                    title="Send Email"
                    className="btn-success"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSendEmail(item)
                    }}
                  >
                    📧
                  </button>
                ) : null}
                {item.status === 'Email Sent' ? (
                  <button
                    title="Mark Complete"
                    className="btn-info"
                    onClick={(event) => {
                      event.stopPropagation()
                      onMarkComplete(item)
                    }}
                  >
                    ✅
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
