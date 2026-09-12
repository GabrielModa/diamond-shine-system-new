'use client'

import { useState } from 'react'
import Link from 'next/link'
import DetailDialog from '../ui/DetailDialog'

export type ClientPause = {
  id: string; scope: string; jobId: string | null; siteId: string | null
  startsAt: string; endsAt: string; reason: string; version: number
}
type Impact = { canApply: boolean; affectedVisits: number; materializedVisits: number;
  expectedOccurrences: number; assignedCleaners: number; plannedLabourHours: number; blockers: Array<{ id: string; site: string }> }

export default function ClientPauseActions({ clientId, jobId, siteId, pauses, refresh }: {
  clientId: string; jobId?: string; siteId?: string; pauses: ClientPause[]; refresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [review, setReview] = useState(false)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [draft, setDraft] = useState({ fromDate: '', untilDate: '', reason: '', note: '' })
  const relevant = pauses.filter(p => jobId ? p.scope === 'client' || p.jobId === jobId || (p.scope === 'site' && p.siteId === siteId) : p.scope === 'client')
  const title = jobId ? 'Pause service' : 'Pause all services'

  async function mutate(url: string, method: string, body: unknown) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error || 'Could not update service pause.')
    return result.data
  }
  async function pause(preview: boolean) {
    setBusy(true); setError('')
    try {
      const result = await mutate(`/api/service-pauses${preview ? '?preview=true' : ''}`, 'POST', {
        ...draft, scope: jobId ? 'job' : 'client', targetId: jobId || clientId,
      })
      if (preview) setImpact(result.consequence)
      else { await refresh(); setOpen(false); setImpact(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not pause service.'); setImpact(null) }
    finally { setBusy(false) }
  }
  async function resume(p: ClientPause) {
    setBusy(true); setError('')
    try {
      const result = await mutate(`/api/service-pauses/${p.id}`, 'PATCH', { version: p.version })
      await refresh()
      setMessage('Pause ended early. Historical cancellations remain and were not automatically restored. Review future recurring work in Schedule.')
      setReview(result.affectedFutureVisits > 0)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not resume service.') }
    finally { setBusy(false) }
  }
  return <div>
    {relevant.map(p => <div key={p.id}>
      <strong>{new Date(p.startsAt) <= new Date() ? 'Paused' : 'Scheduled pause'}</strong>
      <p>{new Date(p.startsAt).toLocaleDateString('en-IE')} – {new Date(new Date(p.endsAt).getTime() - 1).toLocaleDateString('en-IE')} · {p.reason}</p>
      {(!jobId || p.scope === 'job') ? <button className="client-text-button" disabled={busy} onClick={() => void resume(p)}>{jobId ? 'Resume service' : 'Resume all services'}</button> : <p>Resume this pause from the account lifecycle controls.</p>}
    </div>)}
    {!relevant.length ? <button className="client-text-button" onClick={() => { setOpen(true); setError(''); setImpact(null) }}>{title}</button> : null}
    {error && !open ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message} {review ? <Link href="/schedule">Review Schedule</Link> : null}</p> : null}
    <DetailDialog open={open} title={title} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="client-dialog-form" onSubmit={e => { e.preventDefault(); void pause(!impact) }}>
        {error ? <p role="alert">{error}</p> : null}
        <label>From<input type="date" required value={draft.fromDate} onChange={e => { setDraft({ ...draft, fromDate: e.target.value }); setImpact(null) }} /></label>
        <label>Until<input type="date" required min={draft.fromDate} value={draft.untilDate} onChange={e => { setDraft({ ...draft, untilDate: e.target.value }); setImpact(null) }} /></label>
        <label>Reason<input required value={draft.reason} onChange={e => { setDraft({ ...draft, reason: e.target.value }); setImpact(null) }} /></label>
        <label>Note<textarea value={draft.note} onChange={e => { setDraft({ ...draft, note: e.target.value }); setImpact(null) }} /></label>
        {impact ? <div role="status"><p>{impact.affectedVisits} affected service obligations · {impact.materializedVisits} generated visits · {impact.expectedOccurrences} future expected occurrences</p>
          <p>{impact.assignedCleaners} assigned cleaners · {impact.plannedLabourHours} planned labour hours</p>
          {impact.blockers.map(b => <p key={b.id}>In-progress blocker: {b.site}</p>)}</div> : null}
        <button type="button" className="client-button-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button className="client-button" disabled={busy || (!!impact && !impact.canApply)}>{busy ? 'Saving…' : impact ? 'Confirm pause' : 'Preview impact'}</button>
      </form>
    </DetailDialog>
  </div>
}