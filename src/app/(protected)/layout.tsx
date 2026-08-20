import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Page, UserRole } from '../../types'
import { PAGE_ACCESS } from '../../lib/constants'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'
import { prisma } from '../../lib/prisma'

const pageMeta: Record<string, { label: string; href: string }> = {
  home: { label: 'Home', href: '/home' },
  supplies: { label: 'Supplies', href: '/supplies' },
  'my-requests': { label: 'My requests', href: '/my-requests' },
  feedback: { label: 'Feedback', href: '/feedback' },
  dashboard: { label: 'Dashboard', href: '/dashboard' },
  users: { label: 'Users', href: '/users' },
  communications: { label: 'Communications', href: '/communications' },
  audit: { label: 'Audit', href: '/audit' },
}

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await verifySessionToken(cookies().get(sessionCookie.name)?.value)
  if (!session) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { email: session.email },
    select: { role: true, status: true },
  })
  if (!user || user.status !== 'active') redirect('/login')

  const role = user.role as UserRole
  const allowed = PAGE_ACCESS[role] ?? ['home']
  const currentPage = headers().get('x-diamond-path')?.split('/').filter(Boolean)[0]
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
