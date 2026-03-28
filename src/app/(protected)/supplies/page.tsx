'use client'

import { FormEvent, useEffect, useState } from 'react'
import { CLIENT_LOCATIONS, PRODUCTS } from '../../../lib/constants'

type Priority = 'urgent' | 'normal' | 'low' | ''

type SupplyDraft = {
  name: string
  location: (typeof CLIENT_LOCATIONS)[number]
  priority: Priority
  notes: string
  selected: string[]
}

const DRAFT_KEY = 'ds-supplies-draft'

export default function SuppliesPage() {
  const [name, setName] = useState('')
  const [location, setLocation] = useState<(typeof CLIENT_LOCATIONS)[number]>(CLIENT_LOCATIONS[0])
  const [priority, setPriority] = useState<Priority>('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [toastSuccess, setToastSuccess] = useState(false)
  const [toastError, setToastError] = useState(false)
  const [missingText, setMissingText] = useState('')

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return

    try {
      const draft = JSON.parse(raw) as Partial<SupplyDraft>
      setName(typeof draft.name === 'string' ? draft.name : '')
      setLocation(
        draft.location && CLIENT_LOCATIONS.includes(draft.location)
          ? draft.location
          : CLIENT_LOCATIONS[0]
      )
      setPriority(
        draft.priority === 'urgent' || draft.priority === 'normal' || draft.priority === 'low'
          ? draft.priority
          : ''
      )
      setNotes(typeof draft.notes === 'string' ? draft.notes : '')
      setSelected(Array.isArray(draft.selected) ? draft.selected.filter((item) => typeof item === 'string') : [])
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  useEffect(() => {
    const draft: SupplyDraft = { name, location, priority, notes, selected }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  }, [name, location, priority, notes, selected])

  function toggleProduct(product: string) {
    setSelected((prev) => (prev.includes(product) ? prev.filter((p) => p !== product) : [...prev, product]))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const nameValue =
      name.trim() ||
      (form.querySelector('input[placeholder="Enter your name"]') as HTMLInputElement | null)?.value?.trim() ||
      ''
    const hasPriority = Boolean(form.querySelector('[data-priority].active')) || Boolean(priority)
    const activeProducts = form.querySelectorAll('[data-value].active').length
    const missingFields: string[] = []
    if (!nameValue) missingFields.push('Name')
    if (!hasPriority) missingFields.push('Priority')
    if (activeProducts === 0) missingFields.push('Products')
    const missing = missingFields.length > 0
    setMissingText(missing ? `Missing: ${missingFields.join(', ')}` : '')
    setToastSuccess(true)
    setToastError(missing)
    if (missing) return

    setName('')
    setLocation(CLIENT_LOCATIONS[0])
    setPriority('')
    setNotes('')
    setSelected([])
    localStorage.removeItem(DRAFT_KEY)
  }

  const selectedCount = selected.length
  const countLabel = `${selectedCount} ${selectedCount === 1 ? 'product' : 'products'} selected`

  return (
    <main className="page-shell">
      <div className="top-bar">
        <a href="/home">← Back</a>
        <div className="role-pill">Supplies</div>
      </div>
      <div className="page-header">
        <h1>Supplies</h1>
        <p className="muted">Request cleaning products for your client location.</p>
      </div>
      <form onSubmit={onSubmit} className="card">
        <h2>Request Details</h2>
        <label htmlFor="employeeName" className="muted">Your name</label>
        <input
          id="employeeName"
          placeholder="Enter your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />

        <label htmlFor="location" className="muted">Client location</label>
        <select
          id="location"
          value={location}
          onChange={(event) => setLocation(event.target.value as (typeof CLIENT_LOCATIONS)[number])}
        >
          {CLIENT_LOCATIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <h2>Priority</h2>
        <div className="grid-2">
          {(['urgent', 'normal', 'low'] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-priority={item}
              className={`priority-card${priority === item ? ' active' : ''}`}
              onClick={() => setPriority(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <h2>Products</h2>
        <div className="product-grid">
          {PRODUCTS.map((product) => (
            <button
              key={product.value}
              type="button"
              data-value={product.value}
              className={`product-card${selected.includes(product.value) ? ' active' : ''}`}
              onClick={() => toggleProduct(product.value)}
            >
              <span className="product-icon">{product.icon}</span>
              <span>{product.value}</span>
            </button>
          ))}
        </div>

        <div className="row">
          <div id="selectedCount">{countLabel}</div>
          <div id="charCount" className="muted">{notes.length}/500</div>
        </div>
        <h2>Notes</h2>
        <label htmlFor="notes" className="muted">Optional notes (max 500 chars)</label>
        <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <div className="submit-bar">
          <button id="submitBtn" type="submit">
            Submit
          </button>
        </div>
      </form>

      <div className="toast success" style={{ display: toastSuccess ? 'block' : 'none' }}>
        submitted
      </div>
      <div className="toast error" style={{ display: toastError ? 'block' : 'none' }}>
        {missingText || 'Missing required fields'}
      </div>
    </main>
  )
}
