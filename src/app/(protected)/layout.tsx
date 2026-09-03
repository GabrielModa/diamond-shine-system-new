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
  order: number
  any?: Capability[]
  roles?: MembershipRole[]
  excludedRoles?: MembershipRole[]
  always?: boolean
  nav?: boolean
}

const pageMeta: Record<string, PageMeta> = {
  // Run operations follows the operating lifecycle: overview -> plan -> cover -> live -> control -> support -> close.
  home: { label: 'Command centre', href: '/home', section: 'control', order: 10, always: true },
  schedule: { label: 'Schedule', href: '/schedule', section: 'control', order: 20, any: ['schedule.read'] },
  people: { label: 'Plan coverage', href: '/people', section: 'control', order: 30, any: ['schedule.manage'] },
  'live-operations': { label: 'Live workforce', href: '/live-operations', section: 'control', order: 40, any: ['schedule.manage'] },
  'field-control': { label: 'Field control', href: '/field-control', section: 'control', order: 50, any: ['visits.review'] },
  supplies: { label: 'Supplies', href: '/supplies', section: 'control', order: 60, any: ['supplies.request'] },
  timesheets: { label: 'Timesheets', href: '/timesheets', section: 'control', order: 70, any: ['time.own.manage', 'time.team.review'] },

  // Quality and management views explain outcomes without replacing the operational workspaces that produce them.
  insights: { label: 'Operations intelligence', href: '/insights', section: 'analytics', order: 10, any: ['visits.review'] },
  'team-performance': { label: 'Team performance', href: '/team-performance', section: 'analytics', order: 20, any: ['schedule.manage'] },
  quality: { label: 'Quality control', href: '/quality', section: 'analytics', order: 30, any: ['quality.inspect'] },
  feedback: { label: 'Service feedback', href: '/feedback', section: 'analytics', order: 40, roles: ['organization_admin', 'field_supervisor'] },
  dashboard: { label: 'Management dashboard', href: '/dashboard', section: 'analytics', order: 50, roles: ['organization_admin', 'field_supervisor'] },

  clients: { label: 'Clients', href: '/clients', section: 'admin', order: 10, any: ['clients.read'], excludedRoles: ['employee'] },
  users: { label: 'People & access', href: '/users', section: 'admin', order: 20, any: ['memberships.manage'], excludedRoles: ['employee'] },
  audit: { label: 'Audit trail', href: '/audit', section: 'admin', order: 30, any: ['audit.read'], excludedRoles: ['employee'] },
  // Advanced operational registries remain permission-protected and directly addressable,
  // but the normal product flow is Client account -> Service -> Schedule.
  'work-orders': { label: 'Work orders', href: '/work-orders', section: 'admin', order: 90, any: ['schedule.read', 'service_plans.read'], excludedRoles: ['employee'], nav: false },
  operations: { label: 'Service setup', href: '/operations', section: 'admin', order: 100, any: ['service_plans.read', 'sites.read'], excludedRoles: ['employee'], nav: false },

  // Personal attention belongs together: communication first, then submitted work, then account settings.
  communications: {
    label: 'Inbox', href: '/communications', section: 'workspace', order: 10,
    roles: ['organization_admin', 'field_supervisor', 'scheduler', 'employee', 'stock_controller', 'quality_inspector'],
  },
  'my-requests': { label: 'My requests', href: '/my-requests', section: 'workspace', order: 20, any: ['supplies.request'] },
  profile: { label: 'My profile', href: '/profile', section: 'workspace', order: 30, always: true },
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
