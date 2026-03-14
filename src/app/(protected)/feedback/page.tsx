'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CLIENT_LOCATIONS, RATING_VALUES } from '../../../lib/constants'
import { calculateOverall, getCategoryLabel } from '../../../lib/business-logic'

const fields = ['cleanliness', 'punctuality', 'equipment', 'clientRelations'] as const

type Field = (typeof fields)[number]

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
    setSubmitted(false)
    if (invalidFields.length > 0) return

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
    <main>
      <h1>Feedback</h1>
      <form onSubmit={onSubmit}>
        <select id="employeeName" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)}>
          <option>Maria Silva</option>
          <option>Emma Employee</option>
        </select>

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

        {fields.map((field) => (
          <div
            key={field}
            className={`rating-card${showErrors && !ratings[field] ? ' group-invalid' : ''}`}
            data-field={field}
          >
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
        ))}

        {hasAny ? (
          <div id="resultsPanel">
            <span id="overallScore">{formatOverall(overall)}</span>
            <span id="overallCategory">{category.toUpperCase()}</span>
          </div>
        ) : null}

        <textarea id="comments" value={comments} onChange={(event) => setComments(event.target.value)} />
        <button id="submitBtn" type="submit">
          Submit
        </button>
      </form>

      {submitted ? <div className="toast success">submitted</div> : null}
    </main>
  )
}
