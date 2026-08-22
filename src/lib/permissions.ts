import type { MembershipRole, ScopeType } from '@prisma/client'

export const CAPABILITIES = [
  'organization.manage',
  'memberships.manage',
  'audit.read',
  'communications.manage',
  'clients.read',
  'clients.manage',
  'sites.read',
  'sites.manage',
  'service_plans.read',
  'service_plans.manage',
  'schedule.read',
  'schedule.manage',
  'visits.execute',
  'visits.review',
  'incidents.manage',
  'time.own.manage',
  'time.team.review',
  'payroll.release',
  'supplies.request',
  'supplies.manage',
  'quality.inspect',
  'finance.read',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export type PermissionScope = {
  type: ScopeType
  id?: string | null
}

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set(CAPABILITIES)

const ROLE_CAPABILITIES: Record<MembershipRole, ReadonlySet<Capability>> = {
  organization_admin: ALL_CAPABILITIES,
  field_supervisor: new Set([
    'clients.read', 'sites.read', 'service_plans.read', 'schedule.read', 'schedule.manage',
    'visits.execute', 'visits.review', 'incidents.manage', 'time.own.manage', 'time.team.review',
    'supplies.request', 'supplies.manage', 'quality.inspect',
  ]),
  scheduler: new Set(['clients.read', 'sites.read', 'service_plans.read', 'schedule.read', 'schedule.manage']),
  employee: new Set(['clients.read', 'sites.read', 'schedule.read', 'visits.execute', 'time.own.manage', 'supplies.request']),
  stock_controller: new Set(['clients.read', 'sites.read', 'schedule.read', 'supplies.request', 'supplies.manage', 'finance.read']),
  quality_inspector: new Set(['clients.read', 'sites.read', 'service_plans.read', 'schedule.read', 'visits.review', 'incidents.manage', 'quality.inspect']),
  finance: new Set(['clients.read', 'time.team.review', 'payroll.release', 'finance.read']),
  viewer: new Set(['clients.read', 'sites.read', 'schedule.read']),
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value)
}

export function roleHasCapability(role: MembershipRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability)
}

export function scopeAllows(grant: PermissionScope, requested: PermissionScope): boolean {
  if (grant.type === 'organization') return true
  if (grant.type === 'self') return requested.type === 'self' && grant.id === requested.id
  return grant.type === requested.type && grant.id === requested.id
}

export function hasCapability(input: {
  role: MembershipRole
  capability: Capability
  requestedScope?: PermissionScope
  grants?: Array<{ capability: string; scopeType: ScopeType; scopeId: string }>
}): boolean {
  if (roleHasCapability(input.role, input.capability)) return true
  const requestedScope = input.requestedScope ?? { type: 'organization' as const }
  return (input.grants ?? []).some(
    (grant) => grant.capability === input.capability && scopeAllows(
      { type: grant.scopeType, id: grant.scopeId },
      requestedScope
    )
  )
}
