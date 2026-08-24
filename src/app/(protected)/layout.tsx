import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Page, UserRole } from '../../types'
import { PAGE_ACCESS } from '../../lib/constants'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'
import { prisma } from '../../lib/prisma'

const pageMeta: Record<string, { label: string; href: string; section: 'control' | 'analytics' | 'admin' | 'workspace' }> = {
  home: { label: 'Command centre', href: '/home', section: 'control' },
  schedule: { label: 'Schedule', href: '/schedule', section: 'control' },
  'field-control': { label: 'Field control', href: '/field-control', section: 'control' },
  timesheets: { label: 'Timesheets', href: '/timesheets', section: 'control' },
  supplies: { label: 'Supplies', href: '/supplies', section: 'control' },
  communications: { label: 'Inbox', href: '/communications', section: 'control' },
  insights: { label: 'Operations intelligence', href: '/insights', section: 'analytics' },
  people: { label: 'People & coverage', href: '/people', section: 'analytics' },
  quality: { label: 'Quality control', href: '/quality', section: 'analytics' },
  feedback: { label: 'Service feedback', href: '/feedback', section: 'analytics' },
  dashboard: { label: 'Service performance', href: '/dashboard', section: 'analytics' },
  clients: { label: 'Clients & sites', href: '/clients', section: 'admin' },
  'work-orders': { label: 'Work orders', href: '/work-orders', section: 'admin' },
  operations: { label: 'Service setup', href: '/operations', section: 'admin' },
  users: { label: 'People & access', href: '/users', section: 'admin' },
  audit: { label: 'Audit trail', href: '/audit', section: 'admin' },
  'my-requests': { label: 'My requests', href: '/my-requests', section: 'workspace' },
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const session = await verifySessionToken(cookieStore.get(sessionCookie.name)?.value)
  if (!session) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { email: session.email },
    select: { role: true, status: true },
  })
  if (!user || user.status !== 'active') redirect('/login')

  const role = user.role as UserRole
  const allowed = PAGE_ACCESS[role] ?? ['home']
  const requestHeaders = await headers()
  const currentPage = requestHeaders.get('x-diamond-path')?.split('/').filter(Boolean)[0]
  if (currentPage && !allowed.includes(currentPage as Page)) redirect('/forbidden')
  const items = allowed.map((page) => pageMeta[page])

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <TopNav items={items} />
      <div id="main-content" tabIndex={-1}>{children}</div>
    </>
  )
}
