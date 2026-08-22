import { z } from 'zod'

export const operationalNoticeCreateSchema = z.object({
  siteId: z.string().optional().nullable(),
  visitId: z.string().optional().nullable(),
  type: z.enum(['schedule_change', 'site_instruction', 'incident', 'materials', 'quality', 'general']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  requiresAcknowledgement: z.boolean().default(true),
  expiresAt: z.coerce.date().optional().nullable(),
  userIds: z.array(z.string().min(1)).min(1).max(500),
})

export const operationalNoticeQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  state: z.enum(['unread', 'unacknowledged', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(300).default(100),
})

export const operationalNoticeReceiptSchema = z.object({
  action: z.enum(['seen', 'acknowledged']),
  acknowledgement: z.string().trim().max(2000).optional().nullable(),
})
