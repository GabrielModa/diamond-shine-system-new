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
  const [toast, setToast] = useState<'success' | 'error' | ''>('')

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
    if (!name || !priority || !selected.length) {
      setToast('error')
      return
    }

    setToast('success')
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
    <main>
      <h1>Supplies</h1>
      <form onSubmit={onSubmit}>
        <input placeholder="Enter your name" value={name} onChange={(event) => setName(event.target.value)} />

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

        <div>
          {(['urgent', 'normal', 'low'] as const).map((item) => (
            <button
              key={item}
              type="button"
              data-priority={item}
              className={priority === item ? 'active' : ''}
              onClick={() => setPriority(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div>
          {PRODUCTS.map((product) => (
            <button
              key={product.value}
              type="button"
              data-value={product.value}
              className={selected.includes(product.value) ? 'active' : ''}
              onClick={() => toggleProduct(product.value)}
            >
              {product.value}
            </button>
          ))}
        </div>

        <div id="selectedCount">{countLabel}</div>
        <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <div id="charCount">{notes.length}/500</div>
        <button id="submitBtn" type="submit">
          Submit
        </button>
      </form>

      {toast === 'success' ? <div className="toast success">submitted</div> : null}
      {toast === 'error' ? <div className="toast error">Missing required fields</div> : null}
    </main>
  )
}
