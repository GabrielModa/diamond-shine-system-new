import { z } from 'zod'

const locationFields = {
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracyM: z.number().min(0).max(100_000).optional().nullable(),
  capturedAt: z.coerce.date().optional(),
  source: z.enum(['online', 'offline', 'device', 'manual']).default('online'),
}

function validateCoordinatePair(
  value: { latitude?: number | null; longitude?: number | null },
  context: z.RefinementCtx
) {
  if ((value.latitude == null) !== (value.longitude == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Latitude and longitude must be provided together.' })
  }
}

export const startVisitSchema = z.object({
  ...locationFields,
  clientMutationId: z.string().trim().min(8).max(160).optional(),
  deviceId: z.string().trim().min(1).max(160).optional(),
}).superRefine(validateCoordinatePair)

export const startTimeEntrySchema = z.object({
  ...locationFields,
  kind: z.enum(['driving', 'office', 'supplies', 'break', 'general']),
  startedAt: z.coerce.date().optional(),
  clientMutationId: z.string().trim().min(8).max(160).optional(),
  deviceId: z.string().trim().min(1).max(160).optional(),
}).superRefine(validateCoordinatePair)

export const stopTimeEntrySchema = z.object({
  ...locationFields,
  endedAt: z.coerce.date().optional(),
  clientMutationId: z.string().trim().min(8).max(160).optional(),
  deviceId: z.string().trim().min(1).max(160).optional(),
}).superRefine(validateCoordinatePair)

export const heartbeatSchema = z.object({
  ...locationFields,
}).superRefine(validateCoordinatePair)

export const completeVisitSchema = z.object({
  ...locationFields,
  completedAt: z.coerce.date().optional(),
  clientMutationId: z.string().trim().min(8).max(160).optional(),
  deviceId: z.string().trim().min(1).max(160).optional(),
}).superRefine(validateCoordinatePair)

export const taskResultUpdateSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['pending', 'done', 'not_applicable', 'problem']),
  response: z.unknown().optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
}).superRefine((value, context) => {
  if (value.status === 'problem' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Describe the problem.' })
  }
})

export const evidenceCreateSchema = z.object({
  taskResultId: z.string().optional().nullable(),
  kind: z.enum(['photo', 'signature', 'document', 'note']),
  storageKey: z.string().trim().min(1).max(1000),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(0).max(100 * 1024 * 1024),
  visibility: z.enum(['internal', 'client_safe']).default('internal'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  capturedAt: z.coerce.date().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
}).superRefine(validateCoordinatePair)

export const incidentCreateSchema = z.object({
  category: z.enum(['access', 'security', 'damage', 'safety', 'equipment', 'client', 'materials', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(6000),
})

export const timeEntryReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional().nullable(),
}).superRefine((value, context) => {
  if (value.decision === 'rejected' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'A rejection reason is required.' })
  }
})

export const timeEntryDisputeCreateSchema = z.object({
  reason: z.string().trim().min(8).max(2000),
})

export const timeEntryDisputeResolveSchema = z.object({
  decision: z.enum(['accepted', 'declined']),
  resolution: z.string().trim().min(3).max(2000),
})

export const visitReviewSchema = z.object({
  decision: z.enum(['approved', 'rework_requested', 'rejected']),
  note: z.string().trim().max(3000).optional().nullable(),
}).superRefine((value, context) => {
  if (value.decision !== 'approved' && !value.note) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Explain what needs to be corrected.' })
  }
})

export const incidentUpdateSchema = z.object({
  status: z.enum(['acknowledged', 'in_progress', 'resolved', 'closed']),
  resolution: z.string().trim().max(6000).optional().nullable(),
}).superRefine((value, context) => {
  if ((value.status === 'resolved' || value.status === 'closed') && !value.resolution) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resolution'], message: 'Resolution details are required.' })
  }
})

const syncOperationSchema = z.object({
  clientMutationId: z.string().trim().min(8).max(160),
  type: z.enum([
    'visit.start',
    'visit.task.update',
    'visit.evidence.create',
    'visit.incident.create',
    'material.stock.count',
    'time.start',
    'time.stop',
    'visit.complete',
  ]),
  entityId: z.string().trim().min(1).max(160),
  clientCreatedAt: z.coerce.date(),
  payload: z.record(z.unknown()).default({}),
})

export const syncBatchSchema = z.object({
  deviceId: z.string().trim().min(1).max(160),
  operations: z.array(syncOperationSchema).min(1).max(100),
})

export const syncBootstrapQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'End date must be after start date.' })
  }
})
