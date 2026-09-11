import type { Prisma } from '@prisma/client'

export const executionTimeEntrySelect = {
  id: true,
  organizationId: true,
  visitId: true,
  userId: true,
  kind: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  startLatitude: true,
  startLongitude: true,
  startAccuracyM: true,
  startDistanceM: true,
  startLocationClass: true,
  endLatitude: true,
  endLongitude: true,
  endAccuracyM: true,
  endDistanceM: true,
  endLocationClass: true,
  source: true,
  clientMutationId: true,
  reviewReason: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TimeEntrySelect

export type ExecutionTimeEntry = Prisma.TimeEntryGetPayload<{
  select: typeof executionTimeEntrySelect
}>
