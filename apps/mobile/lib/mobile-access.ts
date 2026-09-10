import type { MembershipRole } from './types';

export type MobileOperationsArea = 'schedule' | 'supplies' | 'quality';

const ROLE_AREAS: Record<MembershipRole, readonly MobileOperationsArea[]> = {
  organization_admin: ['schedule', 'supplies', 'quality'],
  field_supervisor: ['schedule', 'supplies', 'quality'],
  scheduler: ['schedule'],
  employee: [],
  stock_controller: ['supplies'],
  quality_inspector: ['quality'],
  finance: [],
  viewer: [],
};

export function mobileOperationsAreas(role?: MembershipRole | null): readonly MobileOperationsArea[] {
  return role ? ROLE_AREAS[role] : [];
}

export function canUseMobileOperations(role?: MembershipRole | null) {
  return mobileOperationsAreas(role).length > 0;
}

export function mobileOperationsSummary(role?: MembershipRole | null) {
  return mobileOperationsAreas(role).join(', ') || 'field work';
}
