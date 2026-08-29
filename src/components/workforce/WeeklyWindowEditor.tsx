'use client'

import { useMemo, useState } from 'react'
import TimeField12h from '../ui/TimeField12h'
import { formatMinuteOfDay } from '../../lib/operational-time'

export type WeeklyRule = {
  dayOfWeek: number
  startsMinute: number
  endsMinute: number
  reason?: string | null
}

type Draft = {
  days: number[]
  startsMinute: number
  endsMinute: number
  reason: string
}

type GroupedRule = Draft & { key: string }

const DAYS = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'],
] as const

const PRESETS = [
  { label: 'Mon–Thu', days: [1, 2, 3, 4] },
  { label: 'Mon–Fri', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend', days: [6, 7] },
  { label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
] as const

function groupedRules(value: WeeklyRule[]) {
  const groups = new Map<string, GroupedRule>()
  for (const rule of value) {
    const reason = rule.reason?.trim() ?? ''
    const key = `${rule.startsMinute}|${rule.endsMinute}|${reason}`
    const existing = groups.get(key)
    if (existing) existing.days.push(rule.dayOfWeek)
    else groups.set(key, {
      key,
      days: [rule.dayOfWeek],
      startsMinute: rule.startsMinute,
      endsMinute: rule.endsMinute,
      reason,
    })
  }
  return Array.from(groups.values()).map((group) => ({ ...group, days: [...group.days].sort((a, b) => a - b) }))
}

function ruleLabel(group: GroupedRule) {
  const labels = group.days.map((day) => DAYS.find(([value]) => value === day)?.[1] ?? String(day)).join(', ')
  return `${labels} · ${formatMinuteOfDay(group.startsMinute)}–${formatMinuteOfDay(group.endsMinute)}`
}

export default function WeeklyWindowEditor({
  value,
  onChange,
  reasonEnabled = false,
  emptyText,
  addLabel = 'Add time block',
  defaultStart = 540,
  defaultEnd = 750,
}: {
  value: WeeklyRule[]
  onChange: (value: WeeklyRule[]) => void
  reasonEnabled?: boolean
  emptyText: string
  addLabel?: string
  defaultStart?: number
  defaultEnd?: number
}) {
  const groups = useMemo(() => groupedRules(value), [value])
  const [draft, setDraft] = useState<Draft>({
    days: [],
    startsMinute: defaultStart,
    endsMinute: defaultEnd,
    reason: '',
  })
  const [draftOpen, setDraftOpen] = useState(false)
  const [error, setError] = useState('')

  function toggleDay(day: number) {
    setDraft((current) => ({
      ...current,
      days: current.days.includes(day)
        ? current.days.filter((value) => value !== day)
        : [...current.days, day].sort((a, b) => a - b),
    }))
    setError('')
  }

  function addRule() {
    if (!draft.days.length) {
      setError('Choose at least one day.')
      return
    }
    if (draft.endsMinute <= draft.startsMinute) {
      setError('Until must be later than From.')
      return
    }

    const incoming = draft.days.map((dayOfWeek) => ({
      dayOfWeek,
      startsMinute: draft.startsMinute,
      endsMinute: draft.endsMinute,
      ...(reasonEnabled ? { reason: draft.reason.trim() || null } : {}),
    }))

    for (const next of incoming) {
      const overlap = value.some((current) =>
        current.dayOfWeek === next.dayOfWeek &&
        next.startsMinute < current.endsMinute &&
        next.endsMinute > current.startsMinute
      )
      if (overlap) {
        const day = DAYS.find(([value]) => value === next.dayOfWeek)?.[1] ?? 'that day'
        setError(`This overlaps another block on ${day}.`)
        return
      }
    }

    onChange([...value, ...incoming])
    setDraft((current) => ({ ...current, days: [], reason: '' }))
    setDraftOpen(false)
    setError('')
  }

  function removeGroup(group: GroupedRule) {
    onChange(value.filter((rule) => {
      const sameReason = (rule.reason?.trim() ?? '') === group.reason
      return !(group.days.includes(rule.dayOfWeek) && rule.startsMinute === group.startsMinute && rule.endsMinute === group.endsMinute && sameReason)
    }))
  }

  return <div style={{ display: 'grid', gap: 12 }}>
    {groups.length ? <div style={{ display: 'grid', gap: 8 }}>
      {groups.map((group) => <div key={group.key} className="row tight" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 12, background: '#f8fafc' }}>
        <div><strong>{ruleLabel(group)}</strong>{group.reason ? <div className="muted">{group.reason}</div> : null}</div>
        <button className="btn-secondary" type="button" onClick={() => removeGroup(group)}>Remove</button>
      </div>)}
    </div> : <p className="muted" style={{ margin: 0 }}>{emptyText}</p>}

    {!draftOpen ? (
      <button
        className="btn-secondary"
        type="button"
        onClick={() => { setDraftOpen(true); setError('') }}
        style={{ justifySelf: 'start' }}
      >
        + {addLabel}
      </button>
    ) : (
      <div style={{ display: 'grid', gap: 12, padding: 14, borderRadius: 14, background: '#f7f8fc', border: '1px solid #e5e7eb' }}>
        <div>
          <strong>New time block</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>Nothing is added until you choose the days and press {addLabel}.</p>
        </div>

        <div className="row tight" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => <button key={preset.label} type="button" className="btn-secondary" onClick={() => { setDraft((current) => ({ ...current, days: [...preset.days] })); setError('') }}>{preset.label}</button>)}
          <button type="button" className="btn-secondary" onClick={() => { setDraft((current) => ({ ...current, days: [] })); setError('') }}>Clear days</button>
        </div>

        <div className="row tight" style={{ flexWrap: 'wrap' }} aria-label="Choose weekdays">
          {DAYS.map(([value, label]) => <button key={value} type="button" className={draft.days.includes(value) ? 'btn-primary' : 'btn-secondary'} onClick={() => toggleDay(value)}>{label}</button>)}
        </div>

        <div className="admin-form-grid weekly-window-grid" data-with-reason={reasonEnabled ? 'true' : 'false'}>
          <div><span style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: '#4b5563' }}>From</span><TimeField12h value={draft.startsMinute} onChange={(minutes) => { setDraft((current) => ({ ...current, startsMinute: minutes })); setError('') }} ariaLabel="From time" /></div>
          <div><span style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', color: '#4b5563' }}>Until</span><TimeField12h value={draft.endsMinute} onChange={(minutes) => { setDraft((current) => ({ ...current, endsMinute: minutes })); setError('') }} ariaLabel="Until time" /></div>
          {reasonEnabled ? <label><span>Reason (optional)</span><input value={draft.reason} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} placeholder="Other job, family care…" /></label> : null}
        </div>

        {error ? <div className="toast error" role="alert">{error}</div> : null}
        <div className="row tight" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-secondary" type="button" onClick={() => { setDraftOpen(false); setDraft((current) => ({ ...current, days: [], reason: '' })); setError('') }}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!draft.days.length} onClick={addRule}>{addLabel}</button>
        </div>
      </div>
    )}
  </div>
}
