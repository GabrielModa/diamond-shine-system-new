'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import DetailDialog from '../ui/DetailDialog'

type Impact = {
  canApply: boolean
  futureRecurringObligations: number
  forecastDays: number
  futureRecurringVisits: number
  assignedCleaners: number
  blockers: Array<{ id: string }>
  manualExtraVisits: number
  historicalVisits: number
}

function defaultEffectiveFrom() {
  const date = new Date(Date.now() + 5 * 60_000)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export default function ClientEndActions({ clientId, version, servicePlanId, refresh }: {
  clientId: string
  version: number
  servicePlanId?: string
  refresh: () => Promise<void>
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [date, setDate] = useState(defaultEffectiveFrom)
  const [reason, setReason] = useState('')
  const [impact, setImpact] = useState<Impact | null>(null)
  const title = servicePlanId ? 'End service' : 'Archive client'

  function openDialog() {
    setDate(defaultEffectiveFrom())
    setReason('')
    setImpact(null)
    setError('')
    setOpen(true)
  }

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const preview = Boolean(servicePlanId) && !impact
      const response = await fetch(
        servicePlanId
          ? `/api/client-accounts/${clientId}/service-end${preview ? '?preview=true' : ''}`
          : `/api/clients/${clientId}?version=${version}`,
        {
          method: servicePlanId ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          ...(servicePlanId ? {
            body: JSON.stringify({
              servicePlanId,
              effectiveFrom: new Date(date).toISOString(),
              reason,
            }),
          } : {}),
        },
      )
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.ok) throw new Error(body?.error || 'Could not apply this operation.')

      if (preview) {
        setImpact(body.data)
        return
      }

      setOpen(false)
      setImpact(null)
      if (servicePlanId) {
        await refresh()
      } else {
        router.push('/clients?lifecycle=archived')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply this operation.')
      // A failed confirm must be previewed again because operational state may have changed.
      if (impact) setImpact(null)
    } finally {
      setBusy(false)
    }
  }

  return <>
    <button
      type="button"
      className="client-text-button"
      data-client-lifecycle-action={servicePlanId ? 'end-service' : 'archive-client'}
      onClick={openDialog}
    >
      {title}
    </button>

    <DetailDialog open={open} title={title} onClose={() => { if (!busy) setOpen(false) }}>
      <form className="client-dialog-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {error ? <p role="alert">{error}</p> : null}

        {servicePlanId ? <>
          <p>Recurring future service stops from the selected time. Completed work and manually-added extra visits remain in history or Schedule.</p>
          <label>
            Effective from
            <input required type="datetime-local" value={date} onChange={(event) => { setDate(event.target.value); setImpact(null) }} />
          </label>
          <small>Time is shown in your browser timezone.</small>
          <label>
            Reason
            <textarea required value={reason} onChange={(event) => { setReason(event.target.value); setImpact(null) }} />
          </label>

          {impact ? <div className="client-lifecycle-impact" role="status">
            <p><strong>{impact.futureRecurringObligations}</strong> recurring obligations stop in the next {impact.forecastDays} days; recurrence stops permanently at the boundary.</p>
            <p>{impact.futureRecurringVisits} generated recurring visits to cancel · {impact.assignedCleaners} assigned cleaners affected</p>
            <p>{impact.manualExtraVisits} manual extra visits preserved · {impact.historicalVisits} historical visits preserved</p>
            {impact.blockers.length ? <p>{impact.blockers.length} visit blocker{impact.blockers.length === 1 ? '' : 's'}. Finish the work or choose a boundary outside the visit.</p> : null}
          </div> : null}
        </> : <p>Archive this client and remove its account hierarchy from current operational selectors. Historical work remains readable. End every current service and complete or cancel outstanding visits first.</p>}

        <div className="client-dialog-actions">
          <button type="button" className="client-button-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          <button className="client-button" disabled={busy || (!!impact && !impact.canApply)}>
            {busy ? 'Saving…' : servicePlanId ? impact ? 'Confirm end service' : 'Preview impact' : 'Confirm archive client'}
          </button>
        </div>
      </form>
    </DetailDialog>
  </>
}
