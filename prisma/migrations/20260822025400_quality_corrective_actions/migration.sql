-- CreateEnum
CREATE TYPE "QualityInspectionType" AS ENUM ('routine', 'spot_check', 'post_incident', 'client_complaint', 'handover');

-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('draft', 'submitted', 'closed');

-- CreateEnum
CREATE TYPE "QualityCheckResult" AS ENUM ('pass', 'fail', 'not_applicable');

-- CreateEnum
CREATE TYPE "CorrectiveActionSeverity" AS ENUM ('minor', 'major', 'critical');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('open', 'accepted', 'in_progress', 'resolved', 'verified', 'waived');

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "visitId" TEXT,
    "inspectorId" TEXT NOT NULL,
    "type" "QualityInspectionType" NOT NULL DEFAULT 'routine',
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'submitted',
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "summary" TEXT,
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "result" "QualityCheckResult" NOT NULL,
    "score" INTEGER NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "finding" TEXT,
    "requiredAction" TEXT,
    "evidence" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "inspectionItemId" TEXT,
    "siteId" TEXT NOT NULL,
    "visitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "CorrectiveActionSeverity" NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_inspections_organizationId_inspectedAt_idx" ON "quality_inspections"("organizationId", "inspectedAt");

-- CreateIndex
CREATE INDEX "quality_inspections_organizationId_siteId_status_idx" ON "quality_inspections"("organizationId", "siteId", "status");

-- CreateIndex
CREATE INDEX "quality_inspections_organizationId_visitId_idx" ON "quality_inspections"("organizationId", "visitId");

-- CreateIndex
CREATE INDEX "quality_inspection_items_organizationId_inspectionId_result_idx" ON "quality_inspection_items"("organizationId", "inspectionId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "corrective_actions_inspectionItemId_key" ON "corrective_actions"("inspectionItemId");

-- CreateIndex
CREATE INDEX "corrective_actions_organizationId_status_dueAt_idx" ON "corrective_actions"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "corrective_actions_organizationId_siteId_status_idx" ON "corrective_actions"("organizationId", "siteId", "status");

-- CreateIndex
CREATE INDEX "corrective_actions_organizationId_assignedToId_status_idx" ON "corrective_actions"("organizationId", "assignedToId", "status");

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_inspectionItemId_fkey" FOREIGN KEY ("inspectionItemId") REFERENCES "quality_inspection_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
