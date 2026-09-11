import { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import TopNav from '../../components/TopNav'
import { pageMeta, type PageMeta } from '../../lib/navigation'
import { currentMembershipAccess } from '../../lib/server-access'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const access = await currentMembershipAccess()
  if (!access) redirect('/login')

  const membership = access.membership
  const allowed = (meta: PageMeta) => Boolean(
    !meta.excludedRoles?.includes(membership.role)
    && (meta.always || meta.any?.some(access.can) || meta.roles?.includes(membership.role))
  )

  const requestHeaders = await headers()
  const currentPage = requestHeaders.get('x-diamond-path')?.split('/').filter(Boolean)[0]
  if (currentPage && pageMeta[currentPage] && !allowed(pageMeta[currentPage])) redirect('/forbidden')
  const items = Object.values(pageMeta)
    .filter((meta) => allowed(meta) && meta.nav !== false)
    .sort((a, b) => a.order - b.order)

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <TopNav items={items} />
      <div id="main-content" tabIndex={-1}>{children}</div>
    </>
  )
}
