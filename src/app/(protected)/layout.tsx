import { ReactNode } from 'react'
import { cookies } from 'next/headers'
import type { UserRole } from '../../types'
import { PAGE_ACCESS } from '../../lib/constants'
import TopNav from '../../components/TopNav'

const pageMeta: Record<string, { label: string; href: string }> = {
  home: { label: 'Home', href: '/home' },
  supplies: { label: 'Supplies', href: '/supplies' },
  feedback: { label: 'Feedback', href: '/feedback' },
  dashboard: { label: 'Dashboard', href: '/dashboard' },
  users: { label: 'Users', href: '/users' },
}

function getRoleFromCookie(): UserRole {
  const role = cookies().get('ds-role')?.value
  if (role === 'admin' || role === 'supervisor' || role === 'employee' || role === 'viewer') return role
  return 'viewer'
}

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const role = getRoleFromCookie()
  const allowed = PAGE_ACCESS[role] ?? ['home']
  const items = allowed.map((page) => pageMeta[page])

  return (
    <>
      <TopNav items={items} />
      {children}
    </>
  )
}
