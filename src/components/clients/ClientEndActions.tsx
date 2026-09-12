'use client'

import { useState } from 'react'
import DetailDialog from '../ui/DetailDialog'

type Impact = { canApply: boolean; futureRecurringObligations: number; forecastDays: number;
  futureRecurringVisits: number; assignedCleaners: number; blockers: Array<{ id: string }>;
  manualExtraVisits: number; historicalVisits: number }

export default function ClientEndActions({ clientId, version, servicePlanId, refresh }: {
  clientId: string; version: number; servicePlanId?: string; refresh: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [impact, setImpact] = useState<Impact | null>(null)
  const title = servicePlanId ? 'End service' : 'Archive client'
  async function submit() {
    setBusy(true); setError('')
    try {
      const preview = !!servicePlanId && !impact
      const response = await fetch(servicePlanId
        ? `/api/client-accounts/${clientId}/service-end${preview ? '?preview=true' : ''}`
        : `/api/clients/${clientId}?version=${version}`, {
        method: servicePlanId ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' },
        ...(servicePlanId ? { body: JSON.stringify({ servicePlanId, effectiveFrom: new Date(date).toISOString(), reason }) } : {}),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || 'Could not apply this operation.')
      if (preview) setImpact(body.data)
      else { await refresh(); setOpen(false); setImpact(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply this operation.'); setImpact(null) }
    finally { setBusy(false) }
  }
  return <>
    <button className="client-text-button" onClick={() => { setOpen(true); setImpact(null); setError('') }}>{title}</button>
    <DetailDialog open={open} title={title} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="client-dialog-form" onSubmit={e => { e.preventDefault(); void submit() }}>
        {error ? <p role="alert">{error}</p> : null}
        {servicePlanId ? <>
          <p>Recurring future service stops from the selected time. History remains. Extra manually-added visits are separate operational records and remain scheduled.</p>
          <label>Effective from<input required type="datetime-local" value={date} onChange={e => { setDate(e.target.value); setImpact(null) }} /></label>
          <small>Time is shown in your browser timezone.</small>
          <label>Reason<textarea required value={reason} onChange={e => { setReason(e.target.value); setImpact(null) }} /></label>
          {impact ? <div role="status">
            <p>{impact.futureRecurringObligations} recurring obligations stop in the next {impact.forecastDays} days; recurrence stops permanently beyond the boundary.</p>
            <p>{impact.futureRecurringVisits} generated recurring visits to cancel · {impact.assignedCleaners} assigned cleaners</p>
            <p>{impact.manualExtraVisits} manual extra visits preserved · {impact.historicalVisits} historical visits preserved</p>
            {impact.blockers.length ? <p>{impact.blockers.length} in-progress blockers. Complete or review affected work first.</p> : null}
          </div> : null}
        </> : <p>Archive this client and its locations from operational selectors. History remains read only. All services must be ended and outstanding visits completed or cancelled first.</p>}
        <button type="button" className="client-button-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button className="client-button" disabled={busy || (!!impact && !impact.canApply)}>{busy ? 'Saving…' : servicePlanId ? impact ? 'Confirm end service' : 'Preview impact' : 'Confirm archive client'}</button>
      </form>
    </DetailDialog>
  </>
}