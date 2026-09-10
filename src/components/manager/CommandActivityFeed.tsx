'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import OpsIcon from '../ui/OpsIcon'
import { timeAgo } from '../../lib/business-logic'

type SupplyActivity = {
  id: string
  createdAt: string
  employeeName: string
  clientLocation: string
  priority: string
  status: string
}
type FeedbackActivity = {
  id: string
  createdAt: string
  employeeName: string
  clientLocation: string
  overall: number
  category: string
}
type IncidentActivity = {
  id: string
  createdAt: string
  title: string
  severity: string
  status: string
  visit: { site: { name: string; client: { displayName: string } } }
}

type Item =
  | { type: 'field'; date: string; id: string; title: string; detail: string; meta: string; href: string }
  | { type: 'supplies'; date: string; id: string; title: string; detail: string; meta: string; href: string }
  | { type: 'feedback'; date: string; id: string; title: string; detail: string; meta: string; href: string }

export default function CommandActivityFeed({
  supplies,
  feedback,
  incidents,
}: {
  supplies: SupplyActivity[]
  feedback: FeedbackActivity[]
  incidents: IncidentActivity[]
}) {
  const [segment, setSegment] = useState<'all' | Item['type']>('all')
  const items = useMemo<Item[]>(() => [
    ...incidents.map((incident) => ({
      type: 'field' as const,
      date: incident.createdAt,
      id: incident.id,
      title: incident.title,
      detail: incident.visit.site.client.displayName + ' · ' + incident.visit.site.name,
      meta: incident.severity + ' · ' + incident.status.replaceAll('_', ' '),
      href: '/field-control',
    })),
    ...supplies.map((request) => ({
      type: 'supplies' as const,
      date: request.createdAt,
      id: request.id,
      title: request.employeeName,
      detail: request.clientLocation,
      meta: request.priority + ' · ' + request.status,
      href: '/supplies',
    })),
    ...feedback.map((entry) => ({
      type: 'feedback' as const,
      date: entry.createdAt,
      id: entry.id,
      title: entry.employeeName,
      detail: entry.clientLocation,
      meta: entry.overall.toFixed(1) + ' · ' + entry.category,
      href: '/feedback',
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [feedback, incidents, supplies])

  const visible = segment === 'all' ? items : items.filter((item) => item.type === segment)

  return <section className="card command-activity" aria-labelledby="command-activity-title">
    <div className="command-activity-head">
      <div className="command-activity-title"><span className="command-icon-tile"><OpsIcon name="activity" /></span><div><span className="eyebrow">What just happened</span><h2 id="command-activity-title">Recent activity</h2></div></div>
      <div className="command-activity-tabs" role="group" aria-label="Filter recent activity">
        {(['all', 'field', 'supplies', 'feedback'] as const).map((item) => <button type="button" key={item} className={segment === item ? 'active' : ''} aria-pressed={segment === item} onClick={() => setSegment(item)}>
          {item === 'all' ? 'All' : item === 'field' ? 'Field' : item === 'supplies' ? 'Supplies' : 'Feedback'}
        </button>)}
      </div>
    </div>
    <div className="command-activity-list">
      {visible.slice(0, 6).map((item) => <Link href={item.href} key={item.type + ':' + item.id} className="command-activity-row">
        <span className={'command-activity-icon ' + item.type}><OpsIcon name={item.type === 'field' ? 'incident' : item.type === 'supplies' ? 'box' : 'star'} size={18} /></span>
        <div><strong>{item.title}</strong><span>{item.detail}</span></div>
        <div className="command-activity-meta"><strong>{item.meta}</strong><span>{timeAgo(item.date)}</span></div>
        <span aria-hidden="true">→</span>
      </Link>)}
      {!visible.length ? <div className="empty-state compact">No recent activity in this view.</div> : null}
    </div>
  </section>
}
