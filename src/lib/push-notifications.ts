import { prisma } from './prisma'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

type PushPayload = {
  userIds: string[]
  title: string
  body: string
  noticeId: string
  priority?: string
}

export async function sendOperationalPush(payload: PushPayload, organizationId: string) {
  const registrations = await prisma.devicePushToken.findMany({
    where: { organizationId, userId: { in: payload.userIds }, active: true },
    select: { id: true, token: true },
  })
  if (!registrations.length) return { ok: true as const, delivered: 0 }

  const invalidIds: string[] = []
  for (let offset = 0; offset < registrations.length; offset += 100) {
    const batch = registrations.slice(offset, offset + 100)
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(process.env.EXPO_PUSH_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch.map((registration) => ({
        to: registration.token,
        title: payload.title,
        body: payload.body,
        sound: 'default',
        channelId: payload.priority === 'critical' || payload.priority === 'high' ? 'urgent-operations' : 'operations',
        data: { type: 'operational_notice', noticeId: payload.noticeId },
        priority: payload.priority === 'critical' ? 'high' : 'default',
      }))),
    }).catch((error: Error) => ({ ok: false as const, status: 503, statusText: error.message, json: async () => null }))
    const result = await response.json().catch(() => null) as { data?: Array<{ status?: string; details?: { error?: string } }> } | null
    if (!response.ok) return { ok: false as const, error: `Expo push service: ${response.status} ${response.statusText}` }
    batch.forEach((registration, index) => {
      if (result?.data?.[index]?.details?.error === 'DeviceNotRegistered') invalidIds.push(registration.id)
    })
  }

  if (invalidIds.length) await prisma.devicePushToken.updateMany({ where: { id: { in: invalidIds } }, data: { active: false } })
  return { ok: true as const, delivered: registrations.length - invalidIds.length }
}


type PushDiagnosticTicket = {
  status?: string
  id?: string
  message?: string
  details?: { error?: string }
}

export async function sendPushDiagnostic(userId: string, organizationId: string) {
  const registrations = await prisma.devicePushToken.findMany({
    where: { organizationId, userId, active: true },
    select: { id: true, token: true, platform: true, lastRegisteredAt: true },
    orderBy: { lastRegisteredAt: 'desc' },
  })
  if (!registrations.length) {
    return {
      ok: false as const,
      reason: 'no_devices' as const,
      error: 'No active mobile device is registered for this user.',
      registered: 0,
      accepted: 0,
      failed: 0,
      invalidated: 0,
      ticketIds: [] as string[],
      platforms: [] as string[],
      lastRegisteredAt: null as Date | null,
    }
  }

  const invalidIds: string[] = []
  const ticketIds: string[] = []
  let accepted = 0
  let failed = 0

  for (let offset = 0; offset < registrations.length; offset += 100) {
    const batch = registrations.slice(offset, offset + 100)
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(process.env.EXPO_PUSH_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_PUSH_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch.map((registration) => ({
        to: registration.token,
        title: 'Diamond Shine mobile notification test',
        body: 'Push delivery test received. Tap to open Team inbox.',
        sound: 'default',
        channelId: 'operations',
        data: { type: 'operational_notice', noticeId: 'delivery-diagnostic' },
        priority: 'default',
      }))),
    }).catch((error: Error) => ({ ok: false as const, status: 503, statusText: error.message, json: async () => null }))

    if (!response.ok) {
      return {
        ok: false as const,
        reason: 'provider_error' as const,
        error: `Expo push service: ${response.status} ${response.statusText}`,
        registered: registrations.length,
        accepted,
        failed: failed + batch.length,
        invalidated: invalidIds.length,
        ticketIds,
        platforms: [...new Set(registrations.map((registration) => registration.platform))],
        lastRegisteredAt: registrations[0]?.lastRegisteredAt ?? null,
      }
    }

    const result = await response.json().catch(() => null) as { data?: PushDiagnosticTicket[] } | null
    batch.forEach((registration, index) => {
      const ticket = result?.data?.[index]
      if (ticket?.status === 'ok') {
        accepted += 1
        if (ticket.id) ticketIds.push(ticket.id)
        return
      }
      failed += 1
      if (ticket?.details?.error === 'DeviceNotRegistered') invalidIds.push(registration.id)
    })
  }

  if (invalidIds.length) {
    await prisma.devicePushToken.updateMany({
      where: { id: { in: invalidIds } },
      data: { active: false },
    })
  }

  return {
    ok: accepted > 0,
    reason: accepted > 0 ? null : 'provider_rejected' as const,
    error: accepted > 0 ? null : 'Expo did not accept the test notification for any registered device.',
    registered: registrations.length,
    accepted,
    failed,
    invalidated: invalidIds.length,
    ticketIds,
    platforms: [...new Set(registrations.map((registration) => registration.platform))],
    lastRegisteredAt: registrations[0]?.lastRegisteredAt ?? null,
  }
}
