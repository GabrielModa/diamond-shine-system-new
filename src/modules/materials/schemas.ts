import { z } from 'zod'

export const materialCreateSchema = z.object({
  sku: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1).max(40).default('unit'),
  defaultParLevel: z.number().int().min(1).max(100_000).default(10),
  defaultReorderPoint: z.number().int().min(0).max(100_000).default(3),
}).superRefine((value, context) => {
  if (value.defaultReorderPoint >= value.defaultParLevel) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultReorderPoint'], message: 'Reorder point must be below par level.' })
  }
})

export const stockCountSchema = z.object({
  visitId: z.string().optional().nullable(),
  source: z.enum(['visit', 'cycle_count', 'delivery', 'adjustment']).default('visit'),
  note: z.string().trim().max(1000).optional().nullable(),
  lines: z.array(z.object({
    catalogItemId: z.string().min(1),
    quantity: z.number().int().min(0).max(1_000_000),
    note: z.string().trim().max(500).optional().nullable(),
  })).min(1).max(250),
}).superRefine((value, context) => {
  if (new Set(value.lines.map((line) => line.catalogItemId)).size !== value.lines.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['lines'], message: 'Each material can only be counted once.' })
  }
})
