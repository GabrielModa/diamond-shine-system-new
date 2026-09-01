'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type VisitUpdateFeedback = {
  message: string
  code?: string | null
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

function isVisitUpdate(url: string, method: string) {
  if (method !== 'PATCH') return false
  try {
    const parsed = new URL(url, window.location.origin)
    return /^\/api\/visits\/[^/]+$/.test(parsed.pathname)
  } catch {
    return false
  }
}

export default function ScheduleVisitFeedbackGuard() {
  const [feedback, setFeedback] = useState<VisitUpdateFeedback | null>(null)
  const [editor, setEditor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    const guardedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      const url = requestUrl(input)
      const method = requestMethod(input, init)

      if (isVisitUpdate(url, method)) {
        const body = await response.clone().json().catch(() => null) as { ok?: boolean; error?: string; code?: string } | null
        if (!response.ok || !body?.ok) {
          setFeedback({
            message: body?.error ?? `This visit could not be saved (${response.status}).`,
            code: body?.code ?? null,
          })
        } else {
          setFeedback(null)
        }
      }

      return response
    }

    window.fetch = guardedFetch
    return () => {
      if (window.fetch === guardedFetch) window.fetch = originalFetch
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      const next = document.querySelector<HTMLElement>('.schedule-edit-sheet')
      setEditor((current) => current === next ? current : next)
      if (!next) setFeedback(null)
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!feedback) return

    const hideFalseSuccessToast = () => {
      document.querySelectorAll<HTMLElement>('.toast.success').forEach((toast) => {
        if (toast.textContent?.includes(feedback.message)) {
          toast.dataset.visitUpdateError = 'true'
          toast.style.display = 'none'
        }
      })
    }

    hideFalseSuccessToast()
    const observer = new MutationObserver(hideFalseSuccessToast)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [feedback])

  useEffect(() => {
    const clearWhenEditing = (event: Event) => {
      if (!feedback) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (document.querySelector('.schedule-edit-sheet')?.contains(target)) setFeedback(null)
    }

    document.addEventListener('input', clearWhenEditing, true)
    document.addEventListener('change', clearWhenEditing, true)
    return () => {
      document.removeEventListener('input', clearWhenEditing, true)
      document.removeEventListener('change', clearWhenEditing, true)
    }
  }, [feedback])

  if (!feedback || !editor) return null

  return createPortal(
    <div
      role="alert"
      data-testid="visit-save-error"
      style={{
        gridColumn: '1 / -1',
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        alignItems: 'start',
        gap: 10,
        margin: '0 0 2px',
        padding: '12px 14px',
        border: '1px solid #efb4b8',
        borderRadius: 14,
        background: '#fff3f4',
        color: '#7f1d2d',
        boxShadow: '0 8px 22px rgba(159, 48, 56, .08)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1.2 }}>⚠</span>
      <div style={{ display: 'grid', gap: 3 }}>
        <strong style={{ fontSize: 13 }}>Could not save this occurrence</strong>
        <span style={{ color: '#7b3c46', fontSize: 12, lineHeight: 1.45 }}>{feedback.message}</span>
      </div>
      <button
        type="button"
        aria-label="Dismiss save error"
        onClick={() => setFeedback(null)}
        style={{
          border: 0,
          background: 'transparent',
          color: '#9f3038',
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: 2,
        }}
      >×</button>
    </div>,
    editor,
  )
}
