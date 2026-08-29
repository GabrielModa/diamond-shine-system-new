import { NextRequest } from 'next/server'
import { getAuthUser } from './auth'
import { getInviteSetupContext } from './invite-setup'

export async function resolvePlaceApiAccess(request: NextRequest) {
  const active = await getAuthUser(request)
  if (active) return { kind: 'active' as const, id: active.id, organizationId: active.organizationId }

  const setupToken = request.headers.get('x-invite-setup-token')?.trim()
  if (!setupToken) return null
  const pending = await getInviteSetupContext(setupToken)
  if (!pending) return null
  return {
    kind: 'invite' as const,
    id: pending.user.id,
    organizationId: pending.membership.organizationId,
  }
}
