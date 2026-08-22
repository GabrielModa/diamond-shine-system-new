import { cookies } from 'next/headers'
import type { UserRole, Page } from '../../../types'
import { PAGE_ACCESS } from '../../../lib/constants'
import { sessionCookie, verifySessionToken } from '../../../lib/session'
import { prisma } from '../../../lib/prisma'
import { dbStatusToLabel } from '../../../lib/mappers'

const cardMeta: Record<Page, { title: string; desc: string; href: string }> = {
  home: { title: 'Home', desc: 'Back to the main overview.', href: '/home' },
  operations: { title: 'Operations Core', desc: 'Manage clients, sites, access, areas and service plans.', href: '/operations' },
  schedule: { title: 'Smart Schedule', desc: 'Dispatch recurring visits, teams and route-ready work.', href: '/schedule' },
  'field-control': { title: 'Field Control', desc: 'Monitor live work, GPS exceptions, incidents and approvals.', href: '/field-control' },
  supplies: {
    title: 'Supplies Requests',
    desc: 'Request cleaning products for client locations.',
    href: '/supplies',
  },
  'my-requests': {
    title: 'My Requests',
    desc: 'Track the progress of requests you submitted.',
    href: '/my-requests',
  },
  feedback: {
    title: 'Performance Feedback',
    desc: 'Rate staff performance across key criteria.',
    href: '/feedback',
  },
  dashboard: {
    title: 'Admin Dashboard',
    desc: 'Review requests, send emails, and track KPIs.',
    href: '/dashboard',
  },
  users: {
    title: 'User Management',
    desc: 'Invite, approve, and deactivate employees.',
    href: '/users',
  },
  communications: { title: 'Team inbox', desc: 'Read important site changes and confirm you have seen them.', href: '/communications' },
  audit: { title: 'Audit Trail', desc: 'Review accountable operational activity.', href: '/audit' },
}

export default async function HomePage() {
  const cookieStore = await cookies()
  const session = await verifySessionToken(cookieStore.get(sessionCookie.name)?.value)
  const role: UserRole = session?.role ?? 'viewer'
  const allowed = PAGE_ACCESS[role] ?? ['home']
  const email = session?.email ?? ''
  const organizationId = session?.organizationId ?? ''
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const user = email ? await prisma.user.findUnique({ where: { email }, select: { name: true } }) : null

  let metrics: Array<{ label: string; value: number; href: string; tone?: string }> = []
  if (role === 'admin') {
    const [pendingRequests, overdueRequests, pendingUsers, recentFeedback] = await Promise.all([
      prisma.supplyRequest.count({ where: { organizationId, status: 'Requested' } }),
      prisma.supplyRequest.count({ where: { organizationId, status: { notIn: ['Delivered', 'Rejected', 'Cancelled'] }, dueAt: { lt: new Date() } } }),
      prisma.membership.count({ where: { organizationId, status: 'invited' } }),
      prisma.feedbackEntry.count({ where: { organizationId, createdAt: { gte: since } } }),
    ])
    metrics = [
      { label: 'New requests', value: pendingRequests, href: '/dashboard', tone: pendingRequests ? 'attention' : 'good' },
      { label: 'Overdue requests', value: overdueRequests, href: '/dashboard', tone: overdueRequests ? 'critical' : 'good' },
      { label: 'Pending users', value: pendingUsers, href: '/users', tone: pendingUsers ? 'attention' : 'good' },
      { label: 'Feedback in 30 days', value: recentFeedback, href: '/dashboard' },
    ]
  } else if (role === 'supervisor') {
    const [ownPending, recentFeedback, activeEmployees] = await Promise.all([
      prisma.supplyRequest.count({ where: { organizationId, submittedBy: email, status: 'Requested' } }),
      prisma.feedbackEntry.count({ where: { organizationId, submittedBy: email, createdAt: { gte: since } } }),
      prisma.membership.count({ where: { organizationId, role: 'employee', status: 'active' } }),
    ])
    metrics = [
      { label: 'My new requests', value: ownPending, href: '/my-requests', tone: ownPending ? 'attention' : 'good' },
      { label: 'Feedback submitted', value: recentFeedback, href: '/feedback' },
      { label: 'Active employees', value: activeEmployees, href: '/feedback' },
    ]
  } else if (role === 'employee') {
    const [pending, inProgress, completed] = await Promise.all([
      prisma.supplyRequest.count({ where: { organizationId, submittedBy: email, status: 'Requested' } }),
      prisma.supplyRequest.count({ where: { organizationId, submittedBy: email, status: { in: ['Triaged', 'Approved', 'Ordered', 'InTransit'] } } }),
      prisma.supplyRequest.count({ where: { organizationId, submittedBy: email, status: 'Delivered' } }),
    ])
    metrics = [
      { label: 'Requested', value: pending, href: '/my-requests', tone: pending ? 'attention' : 'good' },
      { label: 'In progress', value: inProgress, href: '/my-requests' },
      { label: 'Delivered', value: completed, href: '/my-requests', tone: 'good' },
    ]
  }

  const recentRequests = role !== 'viewer' && email
    ? await prisma.supplyRequest.findMany({
        where: role === 'admin'
          ? { organizationId }
          : { organizationId, submittedBy: email },
        orderBy: { createdAt: 'desc' },
        take: 4,
        select: { id: true, clientLocation: true, status: true, priority: true, createdAt: true },
      })
    : []

  return (
    <main className="page-shell">
      <header className="page-header home-hero">
        <div>
          <span className="eyebrow">{role} workspace</span>
          <h1>Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p className="muted">Here is what needs your attention today.</p>
        </div>
        {role !== 'viewer' ? <a href="/supplies" className="btn-primary page-action">New supply request</a> : null}
      </header>

      {metrics.length ? (
        <section aria-labelledby="attention-title">
          <div className="section-heading"><h2 id="attention-title">At a glance</h2><span className="muted">Live operational data</span></div>
          <div className="home-metrics">
            {metrics.map((metric) => (
              <a key={metric.label} href={metric.href} className={`home-metric ${metric.tone ?? ''}`}>
                <span className="muted">{metric.label}</span><strong>{metric.value}</strong><span>View details →</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {recentRequests.length ? (
        <section className="card" aria-labelledby="recent-title">
          <div className="section-heading"><h2 id="recent-title">Recent requests</h2><a href={role === 'admin' ? '/dashboard' : '/my-requests'}>View all</a></div>
          <div className="home-recent-list">
            {recentRequests.map((request) => (
              <a key={request.id} href={role === 'admin' ? '/dashboard' : '/my-requests'} className="home-recent-row">
                <div><strong>{request.clientLocation}</strong><div className="muted">{new Date(request.createdAt).toLocaleDateString('en-IE')}</div></div>
                <div className="row tight"><span className={`badge ${request.priority}`}>{request.priority}</span><span className={`status-badge ${dbStatusToLabel(request.status as import('../../../lib/mappers').DbSupplyStatus).replace(' ', '-')}`}>{dbStatusToLabel(request.status as import('../../../lib/mappers').DbSupplyStatus)}</span></div>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <div className="section-heading"><h2>Tools</h2><span className="muted">Available for your role</span></div>
      <div className="grid-2">
        {allowed
          .filter((page) => page !== 'home')
          .map((page) => (
            <a key={page} className="link-card" href={cardMeta[page].href}>
              <div className="card-icon">
                {page === 'supplies' && '📦'}
                {page === 'operations' && '🏢'}
                {page === 'schedule' && '📅'}
                {page === 'field-control' && '🛰️'}
                {page === 'my-requests' && '🧾'}
                {page === 'feedback' && '⭐'}
                {page === 'dashboard' && '📊'}
                {page === 'users' && '👥'}
                {page === 'communications' && '✉️'}
                {page === 'audit' && '🛡️'}
              </div>
              <strong>{cardMeta[page].title}</strong>
              <span className="muted">{cardMeta[page].desc}</span>
              <span className="card-cta">Open →</span>
            </a>
          ))}
      </div>
    </main>
  )
}
