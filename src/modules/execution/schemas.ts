import { z } from 'zod'

const locationFields = {
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  accuracyM: z.number().int().min(0).max(100_000).optional().nullable(),
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

export const stopTimeEntrySchema = z.object({
  ...locationFields,
  endedAt: z.coerce.date().optional(),
  clientMutationId: z.string().trim().min(8).max(160).optional(),
  deviceId: z.string().trim().min(1).max(160).optional(),
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

