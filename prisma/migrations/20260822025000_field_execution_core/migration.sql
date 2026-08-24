-- CreateEnum
CREATE TYPE "TaskExecutionStatus" AS ENUM ('pending', 'done', 'not_applicable', 'problem');

-- CreateEnum
CREATE TYPE "TimeEntryKind" AS ENUM ('visit', 'driving', 'office', 'supplies', 'break', 'general');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('running', 'completed', 'needs_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "LocationClass" AS ENUM ('verified', 'near', 'suspicious', 'unavailable');

-- CreateEnum
CREATE TYPE "LocationEventKind" AS ENUM ('clock_in', 'clock_out', 'heartbeat', 'manual_correction');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('photo', 'signature', 'document', 'note');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('access', 'security', 'damage', 'safety', 'equipment', 'client', 'materials', 'other');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "OfflineMutationStatus" AS ENUM ('processed', 'duplicate', 'conflicted', 'failed');

-- CreateTable
CREATE TABLE "visit_task_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionTaskId" TEXT NOT NULL,
    "status" "TaskExecutionStatus" NOT NULL DEFAULT 'pending',
    "response" JSONB,
    "note" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_task_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" "TimeEntryKind" NOT NULL,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "startLatitude" DECIMAL(10,7),
    "startLongitude" DECIMAL(10,7),
    "startAccuracyM" INTEGER,
    "startDistanceM" INTEGER,
    "startLocationClass" "LocationClass",
    "endLatitude" DECIMAL(10,7),
    "endLongitude" DECIMAL(10,7),
    "endAccuracyM" INTEGER,
    "endDistanceM" INTEGER,
    "endLocationClass" "LocationClass",
    "source" TEXT NOT NULL DEFAULT 'online',
    "clientMutationId" TEXT,
    "reviewReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT,
    "timeEntryId" TEXT,
    "kind" "LocationEventKind" NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyM" INTEGER,
    "distanceM" INTEGER,
    "classification" "LocationClass",
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'device',

    CONSTRAINT "location_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "taskResultId" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "capturedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "reportedBy" TEXT NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'medium',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_mutations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "mutationType" TEXT NOT NULL,
    "entityId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OfflineMutationStatus" NOT NULL DEFAULT 'processed',
    "result" JSONB,
    "error" TEXT,
    "clientCreatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_task_results_organizationId_visitId_status_idx" ON "visit_task_results"("organizationId", "visitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "visit_task_results_visitId_versionTaskId_key" ON "visit_task_results"("visitId", "versionTaskId");

-- CreateIndex
CREATE INDEX "time_entries_organizationId_userId_startedAt_idx" ON "time_entries"("organizationId", "userId", "startedAt");

-- CreateIndex
CREATE INDEX "time_entries_organizationId_visitId_status_idx" ON "time_entries"("organizationId", "visitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_organizationId_clientMutationId_key" ON "time_entries"("organizationId", "clientMutationId");

-- CreateIndex
CREATE INDEX "location_events_organizationId_visitId_capturedAt_idx" ON "location_events"("organizationId", "visitId", "capturedAt");

-- CreateIndex
CREATE INDEX "evidence_assets_organizationId_visitId_kind_idx" ON "evidence_assets"("organizationId", "visitId", "kind");

-- CreateIndex
CREATE INDEX "incidents_organizationId_status_severity_createdAt_idx" ON "incidents"("organizationId", "status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "offline_mutations_organizationId_userId_processedAt_idx" ON "offline_mutations"("organizationId", "userId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "offline_mutations_organizationId_clientMutationId_key" ON "offline_mutations"("organizationId", "clientMutationId");

-- AddForeignKey
ALTER TABLE "visit_task_results" ADD CONSTRAINT "visit_task_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_task_results" ADD CONSTRAINT "visit_task_results_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_task_results" ADD CONSTRAINT "visit_task_results_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "service_plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_task_results" ADD CONSTRAINT "visit_task_results_versionTaskId_fkey" FOREIGN KEY ("versionTaskId") REFERENCES "service_plan_version_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_events" ADD CONSTRAINT "location_events_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_assets" ADD CONSTRAINT "evidence_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_assets" ADD CONSTRAINT "evidence_assets_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_assets" ADD CONSTRAINT "evidence_assets_taskResultId_fkey" FOREIGN KEY ("taskResultId") REFERENCES "visit_task_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_assets" ADD CONSTRAINT "evidence_assets_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reportedBy_fkey" FOREIGN KEY ("reportedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_mutations" ADD CONSTRAINT "offline_mutations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_mutations" ADD CONSTRAINT "offline_mutations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
