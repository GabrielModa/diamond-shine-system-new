'use client'

import { useEffect, useMemo, useState } from 'react'
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
    byStatus: { pending: number; emailSent: number; completed: number }
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

const WARNING_MESSAGE =
  '⚠️ This request has not been emailed to the client. Mark as completed without sending email?'
const COMPLETE_MESSAGE = '✅ Mark as completed? This cannot be undone.'

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [supplies, setSupplies] = useState<SupplyRequest[]>([])
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([])
  const [listFilter, setListFilter] = useState<{ priority?: SupplyPriority; status?: SupplyStatus }>({})
  const [listTitle, setListTitle] = useState('All Requests')
  const [selectedSupply, setSelectedSupply] = useState<SupplyRequest | null>(null)
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackEntry | null>(null)
  const [detailType, setDetailType] = useState<'supply' | 'feedback' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; action: () => Promise<void> } | null>(null)

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
    })
    const payload = (await res.json()) as ApiResponse<T>
    if (!payload.ok || !payload.data) {
      throw new Error(payload.error || 'Request failed')
    }
    return payload.data
  }

  async function refreshAll() {
    setLoading(true)
    try {
      const [dashboardRes, suppliesRes, feedbackRes] = await Promise.allSettled([
        fetchJson<DashboardResponse>('/api/dashboard'),
        fetchJson<{ items: SupplyRequest[] }>('/api/supplies?limit=200'),
        fetchJson<{ items: FeedbackEntry[] }>('/api/feedback'),
      ])

      if (dashboardRes.status === 'fulfilled') {
        setDashboard(dashboardRes.value)
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
    } catch {
      setToast({ type: 'error', message: 'Failed to load dashboard data.' })
    } finally {
      setLoading(false)
    }
  }

  async function refreshSuppliesOnly() {
    try {
      const suppliesData = await fetchJson<{ items: SupplyRequest[] }>('/api/supplies?limit=200')
      setSupplies(suppliesData.items)
    } catch {
      showToast('error', 'Failed to refresh supplies.')
    }
  }

  async function refreshFeedbackOnly() {
    try {
      const feedbackData = await fetchJson<{ items: FeedbackEntry[] }>('/api/feedback')
      setFeedback(feedbackData.items)
    } catch {
      showToast('error', 'Failed to refresh feedback.')
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  function showToast(type: 'success' | 'error', message: string) {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }

  const mostRequested = dashboard?.supplies.mostRequestedProduct ?? ''

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
            <div>
              <div className="muted">📊 Dashboard</div>
              <div className="header-title">Enhanced Management</div>
            </div>
            <div className="header-meta">Live · Updated on refresh</div>
            <div className="row">
              <button type="button" className="btn-secondary" onClick={() => refreshAll()}>
                Refresh
              </button>
              <a href="/home" className="btn-secondary">
                Back to Home
              </a>
            </div>
          </div>

          {loading ? skeletons : null}

          {!loading && dashboard ? (
            <>
              <SuppliesStats
                requests={supplies}
                mostRequestedProduct={mostRequested}
                activeFilter={listFilter}
                onOpenList={(filter, title) => {
                  setListFilter(filter)
                  setListTitle(title)
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
            title={listTitle}
            requests={supplies}
            filter={listFilter}
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
            onMarkComplete={(request) => {
              setSelectedSupply(request)
              const message = request.status !== 'Email Sent' ? WARNING_MESSAGE : COMPLETE_MESSAGE
              setConfirm({
                message,
                action: async () => {
                  await fetch(`/api/supplies/${request.id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Completed' }),
                  })
                  await refreshAll()
                  showToast('success', 'Request completed.')
                },
              })
              overlay.open('confirm')
            }}
          />

          <SupplyDetailSheet
            open={overlay.isOpen('detail') && detailType === 'supply'}
            request={detailType === 'supply' ? selectedSupply : null}
            onClose={() => overlay.closeTop('outside')}
            onSendEmail={() => overlay.open('email')}
            onCompleteWithoutEmail={() => {
              if (!selectedSupply) return
              setConfirm({
                message: WARNING_MESSAGE,
                action: async () => {
                  await fetch(`/api/supplies/${selectedSupply.id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Completed' }),
                  })
                  await refreshAll()
                  showToast('success', 'Request completed.')
                },
              })
              overlay.open('confirm')
            }}
            onMarkCompleted={() => {
              if (!selectedSupply) return
              setConfirm({
                message: COMPLETE_MESSAGE,
                action: async () => {
                  await fetch(`/api/supplies/${selectedSupply.id}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Completed' }),
                  })
                  await refreshAll()
                  showToast('success', 'Request completed.')
                },
              })
              overlay.open('confirm')
            }}
          />

          <FeedbackDetailSheet
            open={overlay.isOpen('detail') && detailType === 'feedback'}
            entry={detailType === 'feedback' ? selectedFeedback : null}
            onClose={() => overlay.closeTop('outside')}
          />

          <EmailModal
            open={overlay.isOpen('email')}
            request={selectedSupply}
            onClose={() => overlay.closeTop('outside')}
            onSend={async ({ clientEmail, subject, htmlBody }) => {
              if (!selectedSupply) return
              try {
                await fetch(`/api/supplies/${selectedSupply.id}/notify`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientEmail, subject, htmlBody }),
                })
                showToast('success', 'Email sent successfully.')
                overlay.closeTop('ui')
                await refreshAll()
              } catch {
                showToast('error', 'Failed to send email.')
              }
            }}
          />

          <ConfirmModal
            open={overlay.isOpen('confirm')}
            message={confirm?.message ?? ''}
            onClose={() => overlay.closeTop('outside')}
            onConfirm={async () => {
              if (!confirm) return
              await confirm.action()
              overlay.closeTop('ui')
            }}
          />

          {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}
        </main>
      )}
    </OverlayManager>
  )
}
