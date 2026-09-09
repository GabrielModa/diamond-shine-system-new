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

describe('operational email delivery contract', () => {
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

  it('attempts the first queued delivery after the response while retaining the durable worker', () => {
    const queue = source('src/lib/notification-queue.ts')
    expect(queue).toContain("import { after } from 'next/server'")
    expect(queue).toContain('after(async () => {')
    expect(queue).toContain('await processNotificationJob(job.id, job.organizationId)')
    expect(queue).toContain('export async function processDueNotifications')
  })
})
