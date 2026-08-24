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
