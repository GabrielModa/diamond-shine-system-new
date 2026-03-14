'use client'

import { useEffect, useState } from 'react'

export default function DashboardPage() {
  const [overlay, setOverlay] = useState(false)
  const [emailModal, setEmailModal] = useState(false)
  const [confirmModal, setConfirmModal] = useState(false)
  const [toast, setToast] = useState(false)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOverlay(false)
        setEmailModal(false)
        setConfirmModal(false)
      }
    }

    function onPopState() {
      setOverlay(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  function openOverlay() {
    setOverlay(true)
    window.history.pushState({ overlay: true }, '', '#list')
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <div>Urgent</div>
      <div>Normal</div>
      <div>Low</div>
      <button onClick={openOverlay}>All</button>
      <button onClick={openOverlay}>Pending</button>

      <div
        id="listOverlay"
        className={overlay ? 'active' : ''}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setOverlay(false)
          }
        }}
      >
        <div className="status-badge">Pending</div>
        <button
          title="Send Email"
          onClick={(event) => {
            event.stopPropagation()
            setEmailModal(true)
          }}
        >
          Send
        </button>
        <button
          title="Mark Complete"
          onClick={(event) => {
            event.stopPropagation()
            setConfirmModal(true)
          }}
        >
          Complete
        </button>
      </div>

      <div id="emailModal" className={emailModal ? 'active' : ''}>
        <input id="emailSubject" defaultValue="Supplies update" />
        <input id="clientEmail" defaultValue="" />
        <button
          onClick={() => {
            setToast(true)
            setEmailModal(false)
          }}
        >
          Send Email
        </button>
      </div>

      <div id="confirmModal" className={confirmModal ? 'active' : ''}>
        <p id="confirmMessage">This request has not been emailed</p>
      </div>

      {toast ? <div className="toast success">success</div> : null}
    </main>
  )
}
