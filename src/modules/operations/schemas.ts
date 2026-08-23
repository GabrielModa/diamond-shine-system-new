import { z } from 'zod'

const optionalText = z.string().trim().max(2000).optional().nullable()

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  isPrimary: z.boolean().default(false),
})

export const clientCreateSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  legalName: z.string().trim().max(240).optional().nullable(),
  type: z.enum(['commercial', 'residential', 'public_sector', 'internal']).default('commercial'),
  billingEmail: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  externalId: z.string().trim().max(120).optional().nullable(),
  contacts: z.array(contactSchema).max(50).default([]),
})

export const clientUpdateSchema = clientCreateSchema.omit({ contacts: true }).partial().extend({
  version: z.number().int().min(1),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
})

export const siteAccessSchema = z.object({
  accessWindows: z.unknown().optional().nullable(),
  entryInstructions: optionalText,
  keyInstructions: optionalText,
  alarmInstructions: optionalText,
  parkingInstructions: optionalText,
  emergencyContactName: z.string().trim().max(160).optional().nullable(),
  emergencyContactPhone: z.string().trim().max(40).optional().nullable(),
  hazards: z.unknown().optional().nullable(),
  equipment: z.unknown().optional().nullable(),
  securityCloseDown: z.unknown().optional().nullable(),
})

export const areaSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(['building', 'floor', 'zone', 'room', 'fixture', 'asset', 'external']).transform((value) => value === 'external' ? 'zone' as const : value).default('room'),
  code: z.string().trim().max(80).optional().nullable(),
  parentId: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
})

const siteBaseSchema = z.object({
  clientId: z.string().min(1),
  contractIds: z.array(z.string().min(1)).max(50).default([]),
  name: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().min(1).max(240),
  addressLine2: z.string().trim().max(240).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().min(1).max(32),
  countryCode: z.string().trim().length(2).default('IE'),
  timezone: z.string().trim().min(1).max(80).default('Europe/Dublin'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  coordinateAccuracyM: z.number().int().min(0).max(100000).optional().nullable(),
  coordinateSource: z.enum(['manual', 'geocoded', 'gps_verified', 'imported']).default('manual'),
  geofenceVerifiedM: z.number().int().min(25).max(2000).default(150),
  geofenceNearM: z.number().int().min(25).max(5000).default(250),
  geofenceSuspiciousM: z.number().int().min(25).max(10000).default(700),
  access: siteAccessSchema.default({}),
  areas: z.array(areaSchema).max(500).default([]),
})

function validateSiteBands(
  value: {
    latitude?: number | null
    longitude?: number | null
    geofenceVerifiedM?: number
    geofenceNearM?: number
    geofenceSuspiciousM?: number
  },
  context: z.RefinementCtx
) {
  if ((value.latitude == null) !== (value.longitude == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Latitude and longitude must be provided together.' })
  }
  if (
    value.geofenceVerifiedM !== undefined
    && value.geofenceNearM !== undefined
    && value.geofenceSuspiciousM !== undefined
    && !(value.geofenceVerifiedM <= value.geofenceNearM && value.geofenceNearM <= value.geofenceSuspiciousM)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Geofence bands must be ordered.' })
  }
}

export const siteCreateSchema = siteBaseSchema.superRefine(validateSiteBands)

export const siteUpdateSchema = siteBaseSchema.omit({ clientId: true, areas: true }).partial().extend({
  version: z.number().int().min(1),
}).superRefine(validateSiteBands)

const contractBaseSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['draft', 'active', 'paused', 'ended']).default('draft'),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  currency: z.string().trim().length(3).default('EUR'),
  completionPolicy: z.unknown().optional().nullable(),
  siteIds: z.array(z.string().min(1)).max(100).default([]),
})

export const contractCreateSchema = contractBaseSchema.refine(
  (value) => !value.startDate || !value.endDate || value.endDate >= value.startDate,
  {
  message: 'Contract end date must be after the start date.',
  }
)

export const contractUpdateSchema = contractBaseSchema.partial().extend({
  version: z.number().int().min(1),
}).refine((value) => !value.startDate || !value.endDate || value.endDate >= value.startDate, {
  message: 'Contract end date must be after the start date.',
})

export const taskTemplateSchema = z.object({
  areaId: z.string().optional().nullable(),
  title: z.string().trim().min(1).max(240),
  instructions: optionalText,
  responseType: z.enum([
    'done_na_problem', 'yes_no', 'count', 'option', 'text', 'date', 'signature', 'evidence', 'stock_level',
  ]).default('done_na_problem'),
  critical: z.boolean().default(false),
  required: z.boolean().default(true),
  evidenceRequired: z.boolean().default(false),
  evidenceVisibility: z.enum(['internal', 'client_safe']).default('internal'),
  options: z.unknown().optional().nullable(),
  conditionalRules: z.unknown().optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
})

export const servicePlanCreateSchema = z.object({
  contractId: z.string().optional().nullable(),
  siteId: z.string().min(1),
  evidencePolicyId: z.string().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  description: optionalText,
  expectedDurationMinutes: z.number().int().min(1).max(24 * 60),
  requiredWorkers: z.number().int().min(1).max(100).default(1),
  tasks: z.array(taskTemplateSchema).min(1).max(1000),
})

export const servicePlanUpdateSchema = servicePlanCreateSchema.partial().extend({
  version: z.number().int().min(1),
  tasks: z.array(taskTemplateSchema).min(1).max(1000).optional(),
})
