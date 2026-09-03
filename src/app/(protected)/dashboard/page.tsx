'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse, FeedbackEntry, SupplyRequest, SupplyPriority, SupplyStatus } from '../../../types'
import { OverlayManager } from '../../../components/dashboard/OverlayManager'
import { SuppliesStats } from '../../../components/dashboard/SuppliesStats'
import { SupplyListSheet } from '../../../components/dashboard/SupplyListSheet'
import { SupplyDetailSheet } from '../../../components/dashboard/SupplyDetailSheet'
import { FeedbackDetailSheet } from '../../../components/dashboard/FeedbackDetailSheet'
import { EmailModal } from '../../../components/dashboard/EmailModal'
import { ConfirmModal } from '../../../components/dashboard/ConfirmModal'
import { PerformanceOverview } from '../../../components/dashboard/PerformanceOverview'
import { ActivityFeed } from '../../../components/dashboard/ActivityFeed'

type DashboardResponse = {
  supplies: {
    total: number
    byStatus: { requested: number; triaged: number; approved: number; ordered: number; inTransit: number; delivered: number; rejected: number; cancelled: number }
    byPriority: { urgent: number; normal: number; low: number }
    mostRequestedProduct: string
    recent: SupplyRequest[]
  }
  feedback: {
    total: number
    averageOverall: number
    excellentCount: number
    recent: FeedbackEntry[]
  }
}

type ListPreset = {
  period?: 'all' | '7' | '30' | '90' | 'month'
  location?: string
  employee?: string
  search?: string
  overdue?: boolean
  unassigned?: boolean
}

type Assignee = { email: string; name: string | null; role: string; status: string }

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const payload = (await res.json()) as ApiResponse<T>
  if (!res.ok || !payload.ok || !payload.data) throw new Error(payload.error || 'Request failed')
  return payload.data
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [supplies, setSupplies] = useState<SupplyRequest[]>([])
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([])
  const [listFilter, setListFilter] = useState<{ priority?: SupplyPriority; status?: SupplyStatus }>({})
  const [listTitle, setListTitle] = useState('All Requests')
  const [listPreset, setListPreset] = useState<ListPreset | null>(null)
  const [selectedSupply, setSelectedSupply] = useState<SupplyRequest | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackEntry | null>(null)
  const [detailType, setDetailType] = useState<'supply' | 'feedback' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [newSupplies, setNewSupplies] = useState(0)
  const [assignees, setAssignees] = useState<Assignee[]>([])

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboardRes, suppliesRes, feedbackRes, usersRes] = await Promise.allSettled([
        fetchJson<DashboardResponse>('/api/dashboard'),
        fetchJson<{ items: SupplyRequest[] }>('/api/supplies?limit=200'),
        fetchJson<{ items: FeedbackEntry[] }>('/api/feedback'),
        fetchJson<Assignee[]>('/api/users'),
      ])

      if (dashboardRes.status === 'fulfilled') {
        setDashboard(dashboardRes.value)
        setLastUpdated(new Date())
      } else {
        setDashboard(null)
        showToast('error', 'Failed to load dashboard summary.')
      }

      if (suppliesRes.status === 'fulfilled') {
        setSupplies(suppliesRes.value.items)
      } else {
        const fallback = dashboardRes.status === 'fulfilled' ? dashboardRes.value.supplies.recent : []
        setSupplies(fallback)
      }

      if (feedbackRes.status === 'fulfilled') {
        setFeedback(feedbackRes.value.items)
      } else {
        const fallback = dashboardRes.status === 'fulfilled' ? dashboardRes.value.feedback.recent : []
        setFeedback(fallback)
      }
      if (usersRes.status === 'fulfilled') {
        setAssignees(usersRes.value.filter((user) => user.status === 'active' && (user.role === 'admin' || user.role === 'supervisor')))
      }
    } catch {
      setToast({ type: 'error', message: 'Failed to load dashboard data.' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  async function refreshSuppliesOnly() {
    try {
      const suppliesData = await fetchJson<{ items: SupplyRequest[] }>('/api/supplies?limit=200')
      setSupplies(suppliesData.items)
      setLastUpdated(new Date())
    } catch {
      showToast('error', 'Failed to refresh supplies.')
    }
  }

  async function refreshFeedbackOnly() {
    try {
      const feedbackData = await fetchJson<{ items: FeedbackEntry[] }>('/api/feedback')
      setFeedback(feedbackData.items)
      setLastUpdated(new Date())
    } catch {
      showToast('error', 'Failed to refresh feedback.')
    }
  }

  const refreshActivityOnly = useCallback(async () => {
    setSyncing(true)
    try {
      const [suppliesRes, feedbackRes] = await Promise.allSettled([
        fetchJson<{ items: SupplyRequest[] }>('/api/supplies?limit=200'),
        fetchJson<{ items: FeedbackEntry[] }>('/api/feedback'),
      ])

      if (suppliesRes.status === 'fulfilled') {
        const nextSupplies = suppliesRes.value.items
        if (supplies.length) {
          const previous = new Set(supplies.map((item) => item.id))
          const additions = nextSupplies.filter((item) => !previous.has(item.id))
          if (additions.length) setNewSupplies(additions.length)
        }
        setSupplies(nextSupplies)
      }
      if (feedbackRes.status === 'fulfilled') {
        setFeedback(feedbackRes.value.items)
      }
      if (suppliesRes.status === 'fulfilled' || feedbackRes.status === 'fulfilled') {
        setLastUpdated(new Date())
      }
    } catch {
      showToast('error', 'Failed to sync activity.')
    } finally {
      setSyncing(false)
    }
  }, [showToast, supplies])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshActivityOnly()
    }, 120000)
    return () => clearInterval(interval)
  }, [refreshActivityOnly])

  const mostRequested = dashboard?.supplies.mostRequestedProduct ?? ''

  function formatUpdatedLabel(date: Date | null) {
    if (!date) return 'Updating...'
    const diff = Math.floor((Date.now() - date.getTime()) / 1000)
    if (diff < 10) return 'Updated just now'
    if (diff < 60) return `Updated ${diff}s ago`
    if (diff < 3600) return `Updated ${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `Updated ${Math.floor(diff / 3600)}h ago`
    return `Updated ${date.toLocaleDateString('en-IE')}`
  }

  const skeletons = useMemo(
    () => (
      <div className="grid-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton-card" />
        ))}
      </div>
    ),
    []
  )

  return (
    <OverlayManager>
      {(overlay) => (
        <main className="dashboard">
          <div className="top-bar dashboard-header">
            <div className="header-left">
              <div className="muted">Management overview</div>
              <div className="header-title">Management dashboard</div>
              <div className="header-meta">
                {syncing ? (
                  <span className="syncing">
                    <span className="sync-dot" aria-hidden="true" /> Syncing…
                  </span>
                ) : (
                  formatUpdatedLabel(lastUpdated)
                )}
              </div>
            </div>
            <div className="header-actions">
              <button type="button" className="header-refresh" onClick={() => refreshAll()} aria-label="Refresh">
                ↻
              </button>
            </div>
          </div>

          {loading ? skeletons : null}

          {!loading && dashboard ? (
            <>
              <SuppliesStats
                requests={supplies}
                mostRequestedProduct={mostRequested}
                activeFilter={listFilter}
                newCount={newSupplies}
                onOpenList={(filter, title, preset) => {
                  setListFilter(filter)
                  setListTitle(title)
                  setListPreset(preset ?? null)
                  setNewSupplies(0)
                  void refreshSuppliesOnly()
                  overlay.open('list')
                }}
              />

              <div className="grid-2">
                <PerformanceOverview
                  feedback={feedback}
                  onSelectFeedback={(entry) => {
                    setSelectedFeedback(entry)
                    setDetailType('feedback')
                    overlay.open('detail')
                  }}
                />
                <ActivityFeed
                  supplies={supplies}
                  feedback={feedback}
                  onSelectSupply={(request) => {
                    setSelectedSupply(request)
                    setDetailType('supply')
                    overlay.open('detail')
                  }}
                  onSelectFeedback={(entry) => {
                    setSelectedFeedback(entry)
                    setDetailType('feedback')
                    overlay.open('detail')
                  }}
                />
              </div>
            </>
          ) : null}

          <SupplyListSheet
            open={overlay.isOpen('list')}
            active={overlay.isTop('list')}
            title={listTitle}
            requests={supplies}
            filter={listFilter}
            preset={listPreset ?? undefined}
            onClose={() => overlay.closeTop('outside')}
            onSelect={(request) => {
              setSelectedSupply(request)
              setDetailType('supply')
              overlay.open('detail')
            }}
            onSendEmail={(request) => {
              setSelectedSupply(request)
              overlay.open('email')
            }}
          />

          <SupplyDetailSheet
            open={overlay.isOpen('detail') && detailType === 'supply'}
            active={overlay.isTop('detail') && detailType === 'supply'}
            request={detailType === 'supply' ? selectedSupply : null}
            onClose={() => overlay.closeTop('outside')}
            onSendEmail={() => overlay.open('email')}
            onTransition={(status) => {
              if (!selectedSupply) return
              setConfirm({
                message: `${status === 'Rejected' || status === 'Cancelled' ? '⛔' : '→'} Move this request from ${selectedSupply.status} to ${status}?`,
                action: async () => {
                  await fetchJson(`/api/supplies/${selectedSupply.id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status }),
                  })
                  await refreshAll()
                  showToast('success', `Request moved to ${status}.`)
                },
              })
              overlay.open('confirm')
            }}
            assignees={assignees}
            onAssign={async (assigneeEmail) => {
              if (!selectedSupply) return
              try {
                const result = await fetchJson<{ id: string; assignedTo: string | null }>(`/api/supplies/${selectedSupply.id}/assign`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ assigneeEmail }),
                })
                setSelectedSupply((current) => current ? { ...current, assignedTo: result.assignedTo ?? undefined } : current)
                setSupplies((current) => current.map((item) => item.id === result.id ? { ...item, assignedTo: result.assignedTo ?? undefined } : item))
                showToast('success', result.assignedTo ? 'Responsible person assigned.' : 'Request unassigned.')
              } catch (error) {
                showToast('error', error instanceof Error ? error.message : 'Failed to assign request.')
              }
            }}
          />

          <FeedbackDetailSheet
            open={overlay.isOpen('detail') && detailType === 'feedback'}
            active={overlay.isTop('detail') && detailType === 'feedback'}
            entry={detailType === 'feedback' ? selectedFeedback : null}
            onClose={() => overlay.closeTop('outside')}
          />

          <EmailModal
            open={overlay.isOpen('email')}
            active={overlay.isTop('email')}
            request={selectedSupply}
            onClose={() => overlay.closeTop('outside')}
            onSend={async ({ clientEmail, subject, htmlBody }) => {
              if (!selectedSupply) return
              try {
                const res = await fetch(`/api/supplies/${selectedSupply.id}/notify`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientEmail, subject, htmlBody }),
                })
                const payload = (await res.json()) as ApiResponse<{ id: string; queued: boolean; notificationJobId: string }>
                if (!res.ok || !payload.ok) {
                  showToast('error', payload.error || 'Failed to send email.')
                  return
                }
                showToast('success', 'Email queued for delivery. You can track it in Communications.')
                overlay.closeAll()
                await refreshAll()
              } catch {
                showToast('error', 'Failed to send email.')
              }
            }}
          />

          <ConfirmModal
            open={overlay.isOpen('confirm')}
            active={overlay.isTop('confirm')}
            message={confirm?.message ?? ''}
            onClose={() => overlay.closeTop('outside')}
            onConfirm={async () => {
              if (!confirm) return
              await confirm.action()
              overlay.closeAll()
            }}
          />

          {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}
        </main>
      )}
    </OverlayManager>
  )
}
