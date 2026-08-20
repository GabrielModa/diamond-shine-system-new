import { ReactNode } from 'react'
import { cookies } from 'next/headers'
import type { UserRole } from '../../types'
import { PAGE_ACCESS } from '../../lib/constants'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'

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
  const role: UserRole = session?.role ?? 'viewer'
  const allowed = PAGE_ACCESS[role] ?? ['home']
  const items = allowed.map((page) => pageMeta[page])

  return (
    <>
      <TopNav items={items} />
      {children}
    </>
  )
}
