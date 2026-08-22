import { z } from 'zod'

const inspectionItemSchema = z.object({
  category: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  weight: z.number().int().min(1).max(20).default(1),
  result: z.enum(['pass', 'fail', 'not_applicable']),
  critical: z.boolean().default(false),
  finding: z.string().trim().max(4000).optional().nullable(),
  requiredAction: z.string().trim().max(4000).optional().nullable(),
  evidence: z.array(z.object({
    storageKey: z.string().trim().min(1).max(1000),
    fileName: z.string().trim().min(1).max(255),
  })).max(20).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
}).superRefine((value, context) => {
  if (value.result === 'fail' && !value.finding) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['finding'], message: 'Describe the failed check.' })
  }
})

export const qualityInspectionCreateSchema = z.object({
  siteId: z.string().min(1),
  visitId: z.string().optional().nullable(),
  type: z.enum(['routine', 'spot_check', 'post_incident', 'client_complaint', 'handover']).default('routine'),
  summary: z.string().trim().max(6000).optional().nullable(),
  clientVisible: z.boolean().default(false),
  inspectedAt: z.coerce.date().optional(),
  items: z.array(inspectionItemSchema).min(1).max(200),
})

export const qualityInspectionQuerySchema = z.object({
  siteId: z.string().optional(),
  status: z.enum(['draft', 'submitted', 'closed']).optional(),
  result: z.enum(['passed', 'failed']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const correctiveActionUpdateSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'resolved', 'verified', 'waived']),
  assignedToId: z.string().optional().nullable(),
  resolutionNote: z.string().trim().max(6000).optional().nullable(),
  version: z.number().int().min(1),
}).superRefine((value, context) => {
  if ((value.status === 'resolved' || value.status === 'verified' || value.status === 'waived') && !value.resolutionNote) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resolutionNote'], message: 'Resolution details are required.' })
  }
})
