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
  const [submitted, setSubmitted] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowErrors(true)
    setSubmitted(true)
    const form = event.currentTarget
    const ratedFields = fields.filter((field) =>
      form.querySelector(`.rating-card[data-field="${field}"] .opt.active`)
    )
    if (ratedFields.length < fields.length) return

    const finalOverall = calculateOverall(
      ratings.cleanliness ?? 0,
      ratings.punctuality ?? 0,
      ratings.equipment ?? 0,
      ratings.clientRelations ?? 0
    )

    void finalOverall

    setSubmitted(true)
    setRatings({})
    setComments('')
    setShowErrors(false)
    localStorage.removeItem(DRAFT_KEY)
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
        <h2>Employee & Location</h2>
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

        <h2>Ratings</h2>
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

        <h2>Comments</h2>
        <textarea id="comments" value={comments} onChange={(event) => setComments(event.target.value)} />
        <div className="submit-bar">
          <button id="submitBtn" type="submit">
            Submit
          </button>
        </div>
      </form>

      <div className="toast success" style={{ display: submitted ? 'block' : 'none' }}>
        submitted
      </div>
    </main>
  )
}
