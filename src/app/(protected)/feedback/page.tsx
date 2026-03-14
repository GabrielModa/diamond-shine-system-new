'use client'

import { FormEvent, useMemo, useState } from 'react'
import { CLIENT_LOCATIONS, RATING_VALUES } from '../../../lib/constants'
import { calculateOverall, getCategoryLabel } from '../../../lib/business-logic'

const fields = ['cleanliness', 'punctuality', 'equipment', 'clientRelations'] as const

type Field = (typeof fields)[number]

export default function FeedbackPage() {
  const [employeeName, setEmployeeName] = useState('Maria Silva')
  const [location, setLocation] = useState(CLIENT_LOCATIONS[0])
  const [ratings, setRatings] = useState<Partial<Record<Field, number>>>({})
  const [comments, setComments] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const chosen = Object.values(ratings)
  const hasAny = chosen.length > 0
  const overall = chosen.length ? calculateOverall(
    ratings.cleanliness ?? 0,
    ratings.punctuality ?? 0,
    ratings.equipment ?? 0,
    ratings.clientRelations ?? 0,
  ) : 0
  const category = hasAny ? getCategoryLabel(overall) : ''

  const invalidFields = useMemo(() => fields.filter((field) => !ratings[field]), [ratings])

  function selectRating(field: Field, value: number) {
    setRatings((prev) => ({ ...prev, [field]: value }))
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowErrors(true)
    if (invalidFields.length > 0) return
    setSubmitted(true)
    setRatings({})
    setComments('')
    setShowErrors(false)
  }

  return (
    <main>
      <h1>Feedback</h1>
      <form onSubmit={onSubmit}>
        <select id="employeeName" value={employeeName} onChange={(event) => setEmployeeName(event.target.value)}>
          <option>Maria Silva</option>
          <option>Emma Employee</option>
        </select>
        <select id="clientLocation" value={location} onChange={(event) => setLocation(event.target.value as (typeof CLIENT_LOCATIONS)[number])}>
          {CLIENT_LOCATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>

        {fields.map((field) => (
          <div key={field} className={`rating-card${showErrors && !ratings[field] ? ' group-invalid' : ''}`} data-field={field}>
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
            <span id="overallScore">{overall.toFixed(2).replace(/\.00$/, '.0')}</span>
            <span id="overallCategory">{category.toUpperCase()}</span>
          </div>
        ) : null}

        <textarea id="comments" value={comments} onChange={(event) => setComments(event.target.value)} />
        <button id="submitBtn" type="submit">Submit</button>
      </form>
      {submitted ? <div className="toast success">submitted</div> : null}
    </main>
  )
}
