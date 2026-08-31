'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const assignable = members.filter((member) => member.role === 'employee')
    if (!needle) return assignable
    return assignable.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(needle))
  }, [members, query])

  const selected = members.filter((member) => selectedIds.includes(member.id))
  const cleaners = filtered

  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
  }

  return <div ref={pickerRef} className="schedule-team-picker">
    <div className="schedule-team-picker-head">
      <div>
        <strong>{label}</strong>
        {helper ? <small>{helper}</small> : null}
      </div>
      <button type="button" className="btn-secondary" onClick={() => setOpen((value) => !value)}>
        {open ? 'Done' : selected.length ? `Change team · ${selected.length}` : '+ Select team'}
      </button>
    </div>

    {selected.length ? <div className="schedule-team-chips">
      {selected.map((member) => <button key={member.id} type="button" onClick={() => toggle(member.id)}>
        {member.name ?? member.email}<span aria-hidden="true">×</span>
      </button>)}
    </div> : <p className="muted schedule-team-empty">No cleaners selected.</p>}

    {open ? <div className="schedule-team-popover">
      <label className="schedule-team-search">
        <span className="sr-only">Search team member</span>
        <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cleaner by name..." />
      </label>

      <div className="schedule-team-options">
        {cleaners.length ? <section>
          <span className="schedule-team-group-label">Cleaners</span>
          {cleaners.map((member) => <label key={member.id} className={selectedIds.includes(member.id) ? 'selected' : ''}>
            <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggle(member.id)} />
            <span><b>{member.name ?? member.email}</b><small>{member.email}</small></span>
          </label>)}
        </section> : null}

        {!filtered.length ? <p className="muted">No team member matches “{query}”.</p> : null}
      </div>
    </div> : null}
  </div>
}
