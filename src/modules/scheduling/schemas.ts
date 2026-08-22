import { z } from 'zod'

export const recurrenceSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('once') }),
  z.object({ frequency: z.literal('daily'), interval: z.number().int().min(1).max(30).default(1) }),
  z.object({ frequency: z.literal('weekly'), interval: z.number().int().min(1).max(12).default(1), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
])

export const jobCreateSchema = z.object({
  servicePlanId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  startAt: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  timezone: z.string().trim().min(1).max(80).default('Europe/Dublin'),
  durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
  requiredWorkers: z.number().int().min(1).max(100).optional(),
  instructions: z.string().trim().max(4000).optional().nullable(),
  recurrence: recurrenceSchema.default({ frequency: 'once' }),
  assigneeIds: z.array(z.string().min(1)).max(100).default([]),
  generateUntil: z.coerce.date().optional(),
})

export const visitUpdateSchema = z.object({
  version: z.number().int().min(1),
  scheduledStart: z.coerce.date().optional(),
  scheduledEnd: z.coerce.date().optional(),
  dispatchNotes: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(['scheduled', 'dispatched', 'acknowledged', 'cancelled']).optional(),
  cancellationReason: z.string().trim().max(1000).optional().nullable(),
  assigneeIds: z.array(z.string().min(1)).max(100).optional(),
})

export const acknowledgementSchema = z.object({
  status: z.enum(['seen', 'acknowledged', 'declined']),
  reason: z.string().trim().max(1000).optional().nullable(),
})
