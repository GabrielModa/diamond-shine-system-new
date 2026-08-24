-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'cancelled', 'archived');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('scheduled', 'dispatched', 'acknowledged', 'in_progress', 'completion_blocked', 'completed', 'cancelled', 'missed');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('assigned', 'notified', 'seen', 'acknowledged', 'declined', 'removed');

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT,
    "siteId" TEXT NOT NULL,
    "servicePlanId" TEXT NOT NULL,
    "servicePlanVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'draft',
    "recurrence" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "defaultStartMinutes" INTEGER,
    "defaultDurationMin" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Dublin',
    "requiredWorkers" INTEGER NOT NULL DEFAULT 1,
    "instructions" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "servicePlanVersionId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Dublin',
    "status" "VisitStatus" NOT NULL DEFAULT 'scheduled',
    "sequenceNumber" INTEGER NOT NULL,
    "generationKey" TEXT NOT NULL,
    "requiredWorkers" INTEGER NOT NULL DEFAULT 1,
    "dispatchNotes" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,

    CONSTRAINT "visit_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_organizationId_status_startDate_idx" ON "jobs"("organizationId", "status", "startDate");

-- CreateIndex
CREATE INDEX "jobs_organizationId_siteId_status_idx" ON "jobs"("organizationId", "siteId", "status");

-- CreateIndex
CREATE INDEX "visits_organizationId_scheduledStart_status_idx" ON "visits"("organizationId", "scheduledStart", "status");

-- CreateIndex
CREATE INDEX "visits_organizationId_siteId_scheduledStart_idx" ON "visits"("organizationId", "siteId", "scheduledStart");

-- CreateIndex
CREATE UNIQUE INDEX "visits_jobId_generationKey_key" ON "visits"("jobId", "generationKey");

-- CreateIndex
CREATE INDEX "visit_assignments_organizationId_userId_status_idx" ON "visit_assignments"("organizationId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "visit_assignments_visitId_userId_key" ON "visit_assignments"("visitId", "userId");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "service_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_servicePlanVersionId_fkey" FOREIGN KEY ("servicePlanVersionId") REFERENCES "service_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_servicePlanVersionId_fkey" FOREIGN KEY ("servicePlanVersionId") REFERENCES "service_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_assignments" ADD CONSTRAINT "visit_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
