'use client'

import Link from 'next/link'
import { useState } from 'react'
import DetailDialog from '../ui/DetailDialog'

export type ClientPause = {
  id: string
  scope: string
  jobId: string | null
  siteId: string | null
  startsAt: string
  endsAt: string
  reason: string
  version: number
}

type Impact = {
  canApply: boolean
  affectedVisits: number
  materializedVisits: number
  expectedOccurrences: number
  assignedCleaners: number
  plannedLabourHours: number
  blockers: Array<{ id: string; site: string }>
}

function localDate(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export default function ClientPauseActions({ clientId, jobId, siteId, pauses, refresh }: {
  clientId: string
  jobId?: string
  siteId?: string
  pauses: ClientPause[]
  refresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [review, setReview] = useState(false)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [draft, setDraft] = useState({
    fromDate: localDate(),
    untilDate: localDate(7),
    reason: '',
    note: '',
  })

  const now = new Date()
  const relevant = pauses.filter((pause) => {
    const effective = new Date(pause.startsAt) <= now && new Date(pause.endsAt) > now
    const scheduled = new Date(pause.startsAt) > now
    if (!effective && !scheduled) return false
    return jobId
      ? pause.scope === 'client' || pause.jobId === jobId || (pause.scope === 'site' && pause.siteId === siteId)
      : pause.scope === 'client'
  })
  const title = jobId ? 'Pause service' : 'Pause all services'

  function openDialog() {
    setDraft({ fromDate: localDate(), untilDate: localDate(7), reason: '', note: '' })
    setError('')
    setMessage('')
    setReview(false)
    setImpact(null)
    setOpen(true)
  }

  async function mutate(url: string, method: string, body: unknown) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) throw new Error(result?.error || 'Could not update service pause.')
    return result.data
  }

  async function pause(preview: boolean) {
    setBusy(true)
    setError('')
    try {
      const result = await mutate(`/api/service-pauses${preview ? '?preview=true' : ''}`, 'POST', {
        ...draft,
        scope: jobId ? 'job' : 'client',
        targetId: jobId || clientId,
      })
      if (preview) {
        setImpact(result.consequence)
      } else {
        setOpen(false)
        setImpact(null)
        await refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not pause service.')
      if (!preview) setImpact(null)
    } finally {
      setBusy(false)
    }
  }

  async function resume(pause: ClientPause) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await mutate(`/api/service-pauses/${pause.id}`, 'PATCH', { version: pause.version })
      await refresh()
      setMessage('Pause ended early. Historical cancellations remain and were not automatically restored.')
      setReview(result.affectedFutureVisits > 0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not resume service.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="client-pause-actions">
    {relevant.map((pause) => {
      const active = new Date(pause.startsAt) <= now
      return <div className="client-pause-summary" key={pause.id}>
        <strong>{active ? 'Paused' : 'Scheduled pause'}</strong>
        <p>{new Date(pause.startsAt).toLocaleDateString('en-IE')} – {new Date(new Date(pause.endsAt).getTime() - 1).toLocaleDateString('en-IE')} · {pause.reason}</p>
        {(!jobId || pause.scope === 'job')
          ? <button type="button" className="client-text-button" disabled={busy} onClick={() => void resume(pause)}>
              {jobId ? 'Resume service' : 'Resume all services'}
            </button>
          : <small>Resume this account/location pause from its account lifecycle controls.</small>}
      </div>
    })}

    {!relevant.length ? <button
      type="button"
      className="client-text-button"
      data-client-lifecycle-action={jobId ? 'pause-service' : 'pause-all-services'}
      onClick={openDialog}
    >
      {title}
    </button> : null}

    {error && !open ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">
      {message}
      {review ? <> <Link href="/schedule">Review Schedule</Link> for future coverage.</> : null}
    </p> : null}

    <DetailDialog open={open} title={title} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="client-dialog-form" onSubmit={(event) => { event.preventDefault(); void pause(!impact) }}>
        {error ? <p role="alert">{error}</p> : null}
        <label>
          From
          <input type="date" required value={draft.fromDate} onChange={(event) => {
            setDraft({ ...draft, fromDate: event.target.value })
            setImpact(null)
          }} />
        </label>
        <label>
          Until
          <input type="date" required min={draft.fromDate} value={draft.untilDate} onChange={(event) => {
            setDraft({ ...draft, untilDate: event.target.value })
            setImpact(null)
          }} />
        </label>
        <label>
          Reason
          <input required value={draft.reason} onChange={(event) => {
            setDraft({ ...draft, reason: event.target.value })
            setImpact(null)
          }} />
        </label>
        <label>
          Note <small>Optional</small>
          <textarea value={draft.note} onChange={(event) => {
            setDraft({ ...draft, note: event.target.value })
            setImpact(null)
          }} />
        </label>

        {impact ? <div className="client-lifecycle-impact" role="status">
          <p>{impact.affectedVisits} affected service obligations · {impact.materializedVisits} generated visits · {impact.expectedOccurrences} expected occurrences</p>
          <p>{impact.assignedCleaners} assigned cleaners · {impact.plannedLabourHours} planned labour hours</p>
          {impact.blockers.map((blocker) => <p key={blocker.id}>In-progress blocker: {blocker.site}</p>)}
        </div> : null}

        <div className="client-dialog-actions">
          <button type="button" className="client-button-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button className="client-button" disabled={busy || (!!impact && !impact.canApply)}>
            {busy ? 'Saving…' : impact ? 'Confirm pause' : 'Preview impact'}
          </button>
        </div>
      </form>
    </DetailDialog>
  </div>
}
