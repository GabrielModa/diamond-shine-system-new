'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CLIENT_LOCATIONS, RATING_VALUES } from '../../../lib/constants'
import { calculateOverall, getCategoryLabel } from '../../../lib/business-logic'

const fields = ['cleanliness', 'punctuality', 'equipment', 'clientRelations'] as const

type Field = (typeof fields)[number]

const fieldLabels: Record<Field, string> = {
  cleanliness: '🧼 Cleanliness Quality',
  punctuality: '⏰ Punctuality',
  equipment: '🔧 Equipment Care',
  clientRelations: '🤝 Client Relations',
}

type FeedbackDraft = {
  employeeName: string
  location: (typeof CLIENT_LOCATIONS)[number]
  ratings: Partial<Record<Field, number>>
  comments: string
}

const DRAFT_KEY = 'ds-feedback-draft'

function formatOverall(value: number): string {
  const roundedTo2 = Math.round(value * 100) / 100
  if (Number.isInteger(roundedTo2)) return `${roundedTo2.toFixed(1)}`
  return `${roundedTo2}`
}

export default function FeedbackPage() {
  const [employeeName, setEmployeeName] = useState('Maria Silva')
  const [location, setLocation] = useState<(typeof CLIENT_LOCATIONS)[number]>(CLIENT_LOCATIONS[0])
  const [ratings, setRatings] = useState<Partial<Record<Field, number>>>({})
  const [comments, setComments] = useState('')
  const [toastSuccess, setToastSuccess] = useState(false)
  const [toastError, setToastError] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function flashSuccess() {
    setToastSuccess(true)
    setTimeout(() => setToastSuccess(false), 2200)
  }

  function flashError(message: string) {
    setErrorText(message)
    setToastError(true)
    setTimeout(() => setToastError(false), 3000)
  }

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return

    try {
      const draft = JSON.parse(raw) as Partial<FeedbackDraft>
      setEmployeeName(typeof draft.employeeName === 'string' ? draft.employeeName : 'Maria Silva')
      setLocation(
        draft.location && CLIENT_LOCATIONS.includes(draft.location)
          ? draft.location
          : CLIENT_LOCATIONS[0]
      )
      setRatings((draft.ratings as Partial<Record<Field, number>>) ?? {})
      setComments(typeof draft.comments === 'string' ? draft.comments : '')
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [])

  useEffect(() => {
    const draft: FeedbackDraft = { employeeName, location, ratings, comments }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  }, [employeeName, location, ratings, comments])

  const selectedRatings = fields
    .map((field) => ratings[field])
    .filter((value): value is number => typeof value === 'number')

  const hasAny = selectedRatings.length > 0
  const overall = hasAny
    ? selectedRatings.reduce((sum, value) => sum + value, 0) / selectedRatings.length
    : 0
  const category = hasAny ? getCategoryLabel(overall) : ''

  const invalidFields = useMemo(() => fields.filter((field) => !ratings[field]), [ratings])

  function selectRating(field: Field, value: number) {
    setRatings((prev) => ({ ...prev, [field]: value }))
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowErrors(true)
    setToastSuccess(false)
    setToastError(false)
    setErrorText('')
    const form = event.currentTarget
    const missingFields = fields.filter((field) => !ratings[field])
    if (missingFields.length > 0) {
      const firstMissing = missingFields[0]
      if (firstMissing) {
        const target = form.querySelector(`.rating-card[data-field="${firstMissing}"]`)
        if (target && 'scrollIntoView' in target) {
          ;(target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      flashError('Please rate all categories before submitting.')
      return
    }

    const finalOverall = calculateOverall(
      ratings.cleanliness ?? 0,
      ratings.punctuality ?? 0,
      ratings.equipment ?? 0,
      ratings.clientRelations ?? 0
    )

    void finalOverall

    setSubmitting(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeName,
          clientLocation: location,
          cleanliness: ratings.cleanliness ?? 0,
          punctuality: ratings.punctuality ?? 0,
          equipment: ratings.equipment ?? 0,
          clientRelations: ratings.clientRelations ?? 0,
          comments: comments.trim() ? comments.trim() : undefined,
        }),
      })

      if (!res.ok) {
        flashError('Failed to submit feedback. Please try again.')
        return
      }

      flashSuccess()
      setRatings({})
      setComments('')
      setShowErrors(false)
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      flashError('Failed to submit feedback. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="page-shell">
      <div className="top-bar">
        <a href="/home">← Back</a>
        <div className="role-pill">Feedback</div>
      </div>
      <div className="page-header">
        <h1>Feedback</h1>
        <p className="muted">Rate performance across four criteria to keep quality high.</p>
      </div>
      <form onSubmit={onSubmit} className="card">
        <div className="form-section">
          <h2>Employee & Location</h2>
          <p className="muted">Select who was evaluated and where the service happened.</p>
        </div>
        <label htmlFor="employeeName" className="muted">Employee</label>
        <select id="employeeName" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)}>
          <option>Maria Silva</option>
          <option>Emma Employee</option>
        </select>

        <label htmlFor="clientLocation" className="muted">Client location</label>
        <select
          id="clientLocation"
          value={location}
          onChange={(event) => setLocation(event.target.value as (typeof CLIENT_LOCATIONS)[number])}
        >
          {CLIENT_LOCATIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <div className="form-section">
          <h2>Ratings</h2>
          <p className="muted">Score each category from 1.0 to 5.0.</p>
        </div>
        <div className="rating-grid">
          {fields.map((field) => (
            <div
              key={field}
              className={`rating-card${showErrors && !ratings[field] ? ' group-invalid' : ''}`}
              data-field={field}
            >
              <div className="muted">{fieldLabels[field]}</div>
              <div className="row">
                {RATING_VALUES.map((value) => (
                  <button
                    key={`${field}-${value}`}
                    type="button"
                    className={`opt${ratings[field] === value ? ' active' : ''}`}
                    data-score={value.toFixed(1)}
                    onClick={() => selectRating(field, value)}
                  >
                    {value.toFixed(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {hasAny ? (
          <div id="resultsPanel" className="row fade-up">
            <span id="overallScore" className="score-pop">{formatOverall(overall)}</span>
            <span id="overallCategory">{category.toUpperCase()}</span>
          </div>
        ) : null}

        <div className="form-section">
          <h2>Comments</h2>
          <p className="muted">Optional: add context for coaching and follow‑up.</p>
        </div>
        <textarea id="comments" value={comments} onChange={(event) => setComments(event.target.value)} />
        <div className="submit-bar">
          <button id="submitBtn" type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </form>

      <div className="toast success toast-strong" style={{ display: toastSuccess ? 'block' : 'none' }}>
        Feedback submitted. It will appear on the dashboard shortly.
      </div>
      <div className="toast error toast-strong" style={{ display: toastError ? 'block' : 'none' }}>
        {errorText || 'Please review the form and try again.'}
      </div>
    </main>
  )
}
