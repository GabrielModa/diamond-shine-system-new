'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ScheduleTeamMember = {
  id: string
  name: string | null
  email: string
  role: string
}

export default function TeamPicker({
  members,
  selectedIds,
  onChange,
  label = 'Select team',
  helper,
}: {
  members: ScheduleTeamMember[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  label?: string
  helper?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds)
  const pickerRef = useRef<HTMLDivElement>(null)

  function dismissPicker() {
    setDraftIds(selectedIds)
    setQuery('')
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDraftIds(selectedIds)
      setQuery('')
      setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousOverflow }
  }, [open, selectedIds])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const assignable = members.filter((member) => member.role === 'employee' || member.role === 'field_supervisor')
    if (!needle) return assignable
    return assignable.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(needle))
  }, [members, query])

  const selected = members.filter((member) => selectedIds.includes(member.id))
  const cleaners = filtered

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
  }

  function toggleDraft(id: string) {
    setDraftIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function togglePicker() {
    if (open) { dismissPicker(); return }
    setDraftIds(selectedIds); setQuery(''); setOpen(true)
  }

  function applyDraft() {
    onChange(draftIds)
    setQuery('')
    setOpen(false)
  }

  return <div ref={pickerRef} className="schedule-team-picker">
    <div className="schedule-team-picker-head">
      <div>
        <strong>{label}</strong>
        {helper ? <small>{helper}</small> : null}
      </div>
      <button type="button" className="btn-secondary" onClick={togglePicker}>
        {open ? 'Cancel' : selected.length ? `Change team · ${selected.length}` : '+ Select team'}
      </button>
    </div>

    {selected.length ? <div className="schedule-team-chips">
      {selected.map((member) => <button key={member.id} type="button" onClick={() => toggle(member.id)}>
        {member.name ?? member.email}<span aria-hidden="true">×</span>
      </button>)}
    </div> : <p className="muted schedule-team-empty">No cleaners selected.</p>}

    {open && typeof document !== 'undefined' ? createPortal(<div className="filter-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissPicker() }}><section className="filter-dialog team-picker-dialog" role="dialog" aria-modal="true" aria-label={label}>
      <header><div><h2>{label}</h2>{helper ? <p className="muted">{helper}</p> : null}</div><button type="button" className="filter-dialog-close" aria-label="Discard team changes" onClick={dismissPicker}>×</button></header>
      <div className="filter-dialog-body"><label className="schedule-team-search"><span>Search</span><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cleaner by name..." /></label>
      <div className="schedule-team-options">
        {cleaners.length ? <section>
          <span className="schedule-team-group-label">Assignable team</span>
          {cleaners.map((member) => <label key={member.id} className={draftIds.includes(member.id) ? 'selected' : ''}>
            <input type="checkbox" checked={draftIds.includes(member.id)} onChange={() => toggleDraft(member.id)} />
            <span><b>{member.name ?? member.email}</b><small>{member.role === 'field_supervisor' ? 'Field supervisor · ' : ''}{member.email}</small></span>
          </label>)}
        </section> : null}

        {!filtered.length ? <p className="muted">No team member matches “{query}”.</p> : null}
      </div></div>
      <footer className="schedule-team-actions"><button type="button" className="text-button" onClick={() => setDraftIds([])}>Clear</button><button type="button" className="btn-primary" onClick={applyDraft}>Apply</button></footer>
    </section></div>, document.body) : null}
  </div>
}
