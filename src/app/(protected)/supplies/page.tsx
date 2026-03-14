'use client'

import { FormEvent, useMemo, useState } from 'react'
import { CLIENT_LOCATIONS } from '../../../lib/constants'

export default function SuppliesPage() {
  const [priority, setPriority] = useState<'urgent' | 'normal' | 'low' | ''>('')
  const [success, setSuccess] = useState(false)
  const selectedCount = useMemo(() => 0, [])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuccess(true)
  }

  return (
    <main>
      <form onSubmit={onSubmit}>
        <input placeholder="Enter your name" />
        <select id="location" defaultValue={CLIENT_LOCATIONS[0]}>
          {CLIENT_LOCATIONS.map((location) => (
            <option key={location} value={location}>{location}</option>
          ))}
        </select>
        <button type="button" data-priority="normal" className={priority === 'normal' ? 'active' : ''} onClick={() => setPriority('normal')}>Normal</button>
        <div id="selectedCount">{selectedCount} products selected</div>
        <button id="submitBtn" type="submit">Submit</button>
      </form>
      {success ? <div className="toast success">submitted</div> : null}
    </main>
  )
}
