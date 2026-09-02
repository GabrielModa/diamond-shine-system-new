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
  excludedRoles?: MembershipRole[]
  always?: boolean
  nav?: boolean
}

const pageMeta: Record<string, PageMeta> = {
  home: { label: 'Command centre', href: '/home', section: 'control', always: true },
  schedule: { label: 'Schedule', href: '/schedule', section: 'control', any: ['schedule.read'] },
  'live-operations': { label: 'Live operations', href: '/live-operations', section: 'control', any: ['schedule.manage'] },
  people: { label: 'Plan coverage', href: '/people', section: 'control', any: ['schedule.manage'] },
  'field-control': { label: 'Field control', href: '/field-control', section: 'control', any: ['visits.review'] },
  timesheets: { label: 'Timesheets', href: '/timesheets', section: 'control', any: ['time.own.manage', 'time.team.review'] },
  supplies: { label: 'Supplies', href: '/supplies', section: 'control', any: ['supplies.request'] },
  communications: {
    label: 'Inbox', href: '/communications', section: 'control',
    roles: ['organization_admin', 'field_supervisor', 'scheduler', 'employee', 'stock_controller', 'quality_inspector'],
  },
  'team-performance': { label: 'Team performance', href: '/team-performance', section: 'analytics', any: ['schedule.manage'] },
  insights: { label: 'Operations intelligence', href: '/insights', section: 'analytics', any: ['visits.review'] },
  quality: { label: 'Quality control', href: '/quality', section: 'analytics', any: ['quality.inspect'] },
  feedback: { label: 'Service feedback', href: '/feedback', section: 'analytics', any: ['quality.inspect'] },
  dashboard: { label: 'Service performance', href: '/dashboard', section: 'analytics', roles: ['organization_admin', 'field_supervisor'] },
  clients: { label: 'Clients', href: '/clients', section: 'admin', any: ['clients.read'], excludedRoles: ['employee'] },
  // Advanced operational registries remain permission-protected and directly addressable,
  // but the normal product flow is Client account -> Service -> Schedule.
  'work-orders': { label: 'Work orders', href: '/work-orders', section: 'admin', any: ['schedule.read', 'service_plans.read'], excludedRoles: ['employee'], nav: false },
  operations: { label: 'Service setup', href: '/operations', section: 'admin', any: ['service_plans.read', 'sites.read'], excludedRoles: ['employee'], nav: false },
  users: { label: 'People & access', href: '/users', section: 'admin', any: ['memberships.manage'], excludedRoles: ['employee'] },
  audit: { label: 'Audit trail', href: '/audit', section: 'admin', any: ['audit.read'], excludedRoles: ['employee'] },
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
    !meta.excludedRoles?.includes(membership.role) && (meta.always || meta.any?.some(can) || meta.roles?.includes(membership.role))
  )

  const requestHeaders = await headers()
  const currentPage = requestHeaders.get('x-diamond-path')?.split('/').filter(Boolean)[0]
  if (currentPage && pageMeta[currentPage] && !allowed(pageMeta[currentPage])) redirect('/forbidden')
  const items = Object.values(pageMeta).filter((meta) => allowed(meta) && meta.nav !== false)

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <TopNav items={items} />
      <div id="main-content" tabIndex={-1}>{children}</div>
    </>
  )
}
