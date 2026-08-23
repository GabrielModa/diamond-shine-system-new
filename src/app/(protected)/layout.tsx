import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Page, UserRole } from '../../types'
import { PAGE_ACCESS } from '../../lib/constants'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'
import { prisma } from '../../lib/prisma'

const pageMeta: Record<string, { label: string; href: string; section: 'manage' | 'operate' | 'legacy' }> = {
  home: { label: 'Overview', href: '/home', section: 'manage' },
  clients: { label: 'Clients', href: '/clients', section: 'manage' },
  'work-orders': { label: 'Work orders', href: '/work-orders', section: 'manage' },
  operations: { label: 'Service setup', href: '/operations', section: 'manage' },
  schedule: { label: 'Schedule', href: '/schedule', section: 'operate' },
  timesheets: { label: 'Timesheets', href: '/timesheets', section: 'operate' },
  'field-control': { label: 'Field control', href: '/field-control', section: 'operate' },
  quality: { label: 'Quality', href: '/quality', section: 'operate' },
  insights: { label: 'Intelligence', href: '/insights', section: 'operate' },
  supplies: { label: 'Supplies', href: '/supplies', section: 'operate' },
  communications: { label: 'Inbox', href: '/communications', section: 'operate' },
  'my-requests': { label: 'My requests', href: '/my-requests', section: 'legacy' },
  feedback: { label: 'Quality feedback', href: '/feedback', section: 'legacy' },
  dashboard: { label: 'Legacy dashboard', href: '/dashboard', section: 'legacy' },
  users: { label: 'Users', href: '/users', section: 'legacy' },
  audit: { label: 'Audit trail', href: '/audit', section: 'legacy' },
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
