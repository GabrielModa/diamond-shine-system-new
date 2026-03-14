'use client'

import { useState } from 'react'

export default function DashboardPage() {
  const [overlay, setOverlay] = useState(false)
  const [emailModal, setEmailModal] = useState(false)
  const [confirmModal, setConfirmModal] = useState(false)
  const [toast, setToast] = useState(false)

  return (
    <main>
      <h1>Dashboard</h1>
      <div>Urgent</div>
      <div>Normal</div>
      <div>Low</div>
      <button onClick={() => setOverlay(true)}>All</button>
      <button onClick={() => setOverlay(true)}>Pending</button>

      <div id="listOverlay" className={overlay ? 'active' : ''} onClick={() => setOverlay(false)}>
        <div className="status-badge">Pending</div>
        <button title="Send Email" onClick={(event) => { event.stopPropagation(); setEmailModal(true) }}>Send</button>
        <button title="Mark Complete" onClick={(event) => { event.stopPropagation(); setConfirmModal(true) }}>Complete</button>
      </div>

      <div id="emailModal" className={emailModal ? 'active' : ''}>
        <input id="emailSubject" defaultValue="Supplies update" />
        <input id="clientEmail" defaultValue="" />
        <button onClick={() => { setToast(true); setEmailModal(false) }}>Send Email</button>
      </div>

      <div id="confirmModal" className={confirmModal ? 'active' : ''}>
        <p id="confirmMessage">This request has not been emailed</p>
      </div>

      {toast ? <div className="toast success">success</div> : null}
    </main>
  )
}
