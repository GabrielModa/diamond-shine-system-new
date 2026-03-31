import { cookies } from 'next/headers'
import type { UserRole, Page } from '../../../types'
import { PAGE_ACCESS } from '../../../lib/constants'

const cardMeta: Record<Page, { title: string; desc: string; href: string }> = {
  home: { title: 'Home', desc: 'Back to the main overview.', href: '/home' },
  supplies: {
    title: 'Supplies Requests',
    desc: 'Request cleaning products for client locations.',
    href: '/supplies',
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
}

function getRoleFromCookie(): UserRole {
  const role = cookies().get('ds-role')?.value
  if (role === 'admin' || role === 'supervisor' || role === 'employee' || role === 'viewer') return role
  return 'viewer'
}

export default function HomePage() {
  const role = getRoleFromCookie()
  const allowed = PAGE_ACCESS[role] ?? ['home']
  return (
    <main className="page-shell">
      <div className="top-bar">
        <span>Diamond Shine</span>
        <div className="role-pill">Home</div>
      </div>
      <div className="page-header">
        <h1>Home</h1>
        <p className="muted">Welcome to Diamond Shine’s internal system.</p>
      </div>
      <div className="grid-2">
        {allowed
          .filter((page) => page !== 'home')
          .map((page) => (
            <a key={page} className="link-card" href={cardMeta[page].href}>
              <div className="card-icon">
                {page === 'supplies' && '📦'}
                {page === 'feedback' && '⭐'}
                {page === 'dashboard' && '📊'}
                {page === 'users' && '👥'}
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
