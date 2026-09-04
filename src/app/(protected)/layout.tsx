import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Capability } from '../../lib/permissions'
import { hasCapability } from '../../lib/permissions'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'
import { prisma } from '../../lib/prisma'
import { pageMeta, type PageMeta } from '../../lib/navigation'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  if (!session) redirect('/login')

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId: session.organizationId,
      status: 'active',
      user: { email: session.email, status: 'active' },
    },
    include: {
      user: { select: { id: true, email: true, name: true, status: true } },
      capabilityGrants: true,
    },
  })
  if (!membership || membership.user.status !== 'active') redirect('/login')

  const can = (capability: Capability) => hasCapability({
    role: membership.role,
    capability,
    grants: membership.capabilityGrants.map((grant) => ({
      capability: grant.capability,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
    })),
  })
  const allowed = (meta: PageMeta) => Boolean(
    !meta.excludedRoles?.includes(membership.role) && (meta.always || meta.any?.some(can) || meta.roles?.includes(membership.role))
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
