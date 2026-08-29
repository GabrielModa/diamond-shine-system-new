import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

const bodySchema = z.object({
  confirmEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict()

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const { id } = await params

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Type the person’s work email to confirm this destructive action.' }, { status: 400 })
  }

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId: auth.user.organizationId,
      userId: id,
      status: { not: 'removed' },
    },
    include: {
      user: { select: { id: true, name: true, email: true, status: true } },
    },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Person not found in this organization.' }, { status: 404 })
  if (membership.user.email.toLowerCase() !== parsed.data.confirmEmail) {
    return NextResponse.json({ ok: false, error: 'The confirmation email does not match this person.' }, { status: 409 })
  }
  if (membership.user.id === auth.user.id) {
    return NextResponse.json({ ok: false, error: 'You cannot delete or remove your own account.' }, { status: 409 })
  }

  if (membership.role === 'organization_admin' && membership.status === 'active') {
    const activeAdmins = await prisma.membership.count({
      where: { organizationId: auth.user.organizationId, role: 'organization_admin', status: 'active' },
    })
    if (activeAdmins <= 1) {
      return NextResponse.json({ ok: false, error: 'At least one active organization administrator is required.' }, { status: 409 })
    }
  }

  let mode: 'deleted' | 'removed' = 'removed'

  if (membership.status === 'invited') {
    const membershipCount = await prisma.membership.count({ where: { userId: membership.user.id, status: { not: 'removed' } } })
    if (membershipCount === 1) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.authToken.deleteMany({
            where: { userId: membership.user.id, organizationId: auth.user.organizationId },
          })
          await tx.user.delete({ where: { id: membership.user.id } })
        })
        mode = 'deleted'
      } catch {
        await prisma.$transaction([
          prisma.authToken.deleteMany({ where: { userId: membership.user.id, organizationId: auth.user.organizationId } }),
          prisma.membership.update({ where: { id: membership.id }, data: { status: 'removed' } }),
        ])
      }
    } else {
      await prisma.$transaction([
        prisma.authToken.deleteMany({ where: { userId: membership.user.id, organizationId: auth.user.organizationId } }),
        prisma.membership.update({ where: { id: membership.id }, data: { status: 'removed' } }),
      ])
    }
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membership.id }, data: { status: 'removed' } })
      await tx.authToken.deleteMany({ where: { userId: membership.user.id, organizationId: auth.user.organizationId } })
      await tx.mobileSession.updateMany({
        where: { userId: membership.user.id, organizationId: auth.user.organizationId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      const activeMemberships = await tx.membership.count({
        where: { userId: membership.user.id, status: 'active' },
      })
      if (activeMemberships === 0) {
        await tx.user.update({ where: { id: membership.user.id }, data: { status: 'inactive' } })
      }
    })
  }

  await logAudit(
    auth.user.email,
    mode === 'deleted' ? 'delete_pending_invitation' : 'remove_user_from_organization',
    'user',
    id,
    {
      email: membership.user.email,
      previousMembershipStatus: membership.status,
      mode,
      preservedOperationalHistory: mode === 'removed',
    },
    auth.user.organizationId,
  )

  return NextResponse.json({
    ok: true,
    data: {
      id,
      mode,
      message: mode === 'deleted'
        ? 'Pending invitation permanently deleted.'
        : 'Person removed from this organization. Historical operational records were preserved.',
    },
  })
}
