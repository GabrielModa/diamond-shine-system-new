import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('mobile transient feedback contract', () => {
  it('hoists legacy success banners into a native-driver toast without changing every screen', () => {
    const ui = source('apps/mobile/components/ui.tsx')
    expect(ui).toContain('function isLegacySuccessFeedback')
    expect(ui).toContain('function TransientToast')
    expect(ui).toContain('childList.filter((child) => child !== transientFeedback)')
    expect(ui).toContain('useNativeDriver: true')
    expect(ui).toContain('}, 2800)')
  })

  it('keeps persistent error banners out of the transient-success detection rule', () => {
    const ui = source('apps/mobile/components/ui.tsx')
    expect(ui).toContain('flattened?.color === colors.success')
    expect(ui).toContain('flattened?.backgroundColor === colors.primarySoft')
    expect(ui).not.toContain('colors.danger && flattened?.backgroundColor')
  })
})

describe('deferred remote push contract', () => {
  it('keeps remote registration behind an explicit release flag', () => {
    const auth = source('apps/mobile/lib/auth-context.tsx')
    const runtime = source('apps/mobile/lib/runtime.ts')
    expect(auth).toContain('pushRegistration: PushRegistrationState')
    expect(auth).toContain('retryPushRegistration(): Promise<void>')
    expect(auth).toContain('if (!session || !remotePushEnabled) return')
    expect(auth).toContain("AppState.addEventListener('change'")
    expect(auth).toContain("if (state === 'active') register()")
    expect(runtime).toContain("process.env.EXPO_PUBLIC_REMOTE_PUSH_ENABLED === 'true'")
  })

  it('describes the active MVP channels without exposing a broken push diagnostic', () => {
    const diagnostics = source('apps/mobile/app/diagnostics.tsx')
    const queue = source('src/lib/notification-queue.ts')
    expect(diagnostics).toContain('Team inbox + email')
    expect(diagnostics).toContain('Remote push is reserved for a future release')
    expect(diagnostics).not.toContain('Retry push registration')
    expect(queue).toContain("process.env.REMOTE_PUSH_ENABLED !== 'true'")
  })

  it('classifies permission, Expo provider and server registration failures', () => {
    const push = source('apps/mobile/lib/push.ts')
    expect(push).toContain("status: 'permission_denied'")
    expect(push).toContain("new PushRegistrationError('provider'")
    expect(push).toContain("new PushRegistrationError('server'")
  })
})

describe('operational email delivery contract', () => {
  it('publishes Broadcast notices to the Team inbox with an explicit email escalation option', () => {
    const schema = source('src/modules/communications/schemas.ts')
    const route = source('src/app/api/operational-notices/route.ts')
    const inbox = source('src/components/communications/OperationalInbox.tsx')
    expect(schema).toContain('sendEmail: z.boolean().default(false)')
    expect(route).toContain('if (parsed.data.sendEmail)')
    expect(route).toContain("kind: 'operational_email'")
    expect(route).not.toContain("kind: 'operational_notice_push'")
    expect(inbox).toContain('Team inbox')
    expect(inbox).toContain('Also send by email')
    expect(inbox).toContain('Phone push notifications are planned for a future release')
  })

  it('exposes an optional operational recipient override in the existing delivery settings', () => {
    const api = source('src/app/api/settings/route.ts')
    const inbox = source('src/components/communications/OperationalInbox.tsx')
    expect(api).toContain("operationalAlerts: optionalEmailList.optional()")
    expect(api).toContain("key: 'operational_email_override'")
    expect(inbox).toContain("operationalAlerts: ''")
    expect(inbox).toContain('Operational emails · test override')
    expect(inbox).toContain('Leave blank to use real event recipients')
  })

  it('uses the override when configured and falls back to workflow recipients when blank', () => {
    const email = source('src/lib/operational-email.ts')
    expect(email).toContain('async function operationalRecipientOverride')
    expect(email).toContain("key: 'operational_email_override'")
    expect(email).toContain('if (override.length) return override')
    expect(email).toContain('...(data.recipientEmails ?? [])')
  })

  it('routes profile-change alerts through the operational mailer so the test override is respected', () => {
    const queue = source('src/lib/notification-queue.ts')
    expect(queue).toContain('function profileChangeAsOperationalEmail')
    expect(queue).toContain("if (kind === 'profile_change_alert')")
    expect(queue).toContain('return sendOperationalEmail(profileChangeAsOperationalEmail')
    expect(queue).not.toContain("if (kind === 'profile_change_alert') return sendProfileChangeNotification")
  })

  it('attempts the first queued delivery after the response while retaining the durable worker', () => {
    const queue = source('src/lib/notification-queue.ts')
    expect(queue).toContain("await import('next/server')")
    expect(queue).not.toContain("import { after } from 'next/server'")
    expect(queue).toContain('after(async () => {')
    expect(queue).toContain('await processNotificationJob(job.id, job.organizationId)')
    expect(queue).toContain('export async function processDueNotifications')
  })
})
