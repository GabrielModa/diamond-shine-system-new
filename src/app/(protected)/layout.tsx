import { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { MembershipRole } from '@prisma/client'
import type { Capability } from '../../lib/permissions'
import { hasCapability } from '../../lib/permissions'
import TopNav from '../../components/TopNav'
import { sessionCookie, verifySessionToken } from '../../lib/session'
import { prisma } from '../../lib/prisma'

type NavSection = 'control' | 'analytics' | 'admin' | 'workspace'
type PageMeta = {
  label: string
  href: string
  section: NavSection
  any?: Capability[]
  roles?: MembershipRole[]
  always?: boolean
}

const pageMeta: Record<string, PageMeta> = {
  home: { label: 'Command centre', href: '/home', section: 'control', always: true },
  schedule: { label: 'Schedule', href: '/schedule', section: 'control', any: ['schedule.read'] },
  'field-control': { label: 'Field control', href: '/field-control', section: 'control', any: ['visits.review'] },
  timesheets: { label: 'Timesheets', href: '/timesheets', section: 'control', any: ['time.own.manage', 'time.team.review'] },
  supplies: { label: 'Supplies', href: '/supplies', section: 'control', any: ['supplies.request'] },
  communications: {
    label: 'Inbox', href: '/communications', section: 'control',
    roles: ['organization_admin', 'field_supervisor', 'scheduler', 'employee', 'stock_controller', 'quality_inspector'],
  },
  insights: { label: 'Operations intelligence', href: '/insights', section: 'analytics', any: ['visits.review'] },
  people: { label: 'People & coverage', href: '/people', section: 'analytics', any: ['schedule.manage'] },
  quality: { label: 'Quality control', href: '/quality', section: 'analytics', any: ['quality.inspect'] },
  feedback: { label: 'Service feedback', href: '/feedback', section: 'analytics', any: ['quality.inspect'] },
  dashboard: { label: 'Service performance', href: '/dashboard', section: 'analytics', roles: ['organization_admin', 'field_supervisor'] },
  clients: { label: 'Clients & sites', href: '/clients', section: 'admin', any: ['clients.read'] },
  'work-orders': { label: 'Work orders', href: '/work-orders', section: 'admin', any: ['schedule.read', 'service_plans.read'] },
  operations: { label: 'Service setup', href: '/operations', section: 'admin', any: ['service_plans.read', 'sites.read'] },
  users: { label: 'People & access', href: '/users', section: 'admin', any: ['memberships.manage'] },
  audit: { label: 'Audit trail', href: '/audit', section: 'admin', any: ['audit.read'] },
  profile: { label: 'My profile', href: '/profile', section: 'workspace', always: true },
  'my-requests': { label: 'My requests', href: '/my-requests', section: 'workspace', any: ['supplies.request'] },
}

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
    meta.always || meta.any?.some(can) || meta.roles?.includes(membership.role)
  )

  const requestHeaders = await headers()
  const currentPage = requestHeaders.get('x-diamond-path')?.split('/').filter(Boolean)[0]
  if (currentPage && pageMeta[currentPage] && !allowed(pageMeta[currentPage])) redirect('/forbidden')
  const items = Object.values(pageMeta).filter(allowed)

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <TopNav items={items} />
      <div id="main-content" tabIndex={-1}>{children}</div>
    </>
  )
}
