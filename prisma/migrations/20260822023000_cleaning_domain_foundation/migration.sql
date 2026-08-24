-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('commercial', 'residential', 'public_sector', 'internal');

-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('draft', 'active', 'paused', 'ended', 'archived');

-- CreateEnum
CREATE TYPE "CoordinateSource" AS ENUM ('manual', 'geocoded', 'gps_verified', 'imported');

-- CreateEnum
CREATE TYPE "AreaType" AS ENUM ('building', 'floor', 'zone', 'room', 'fixture', 'asset');

-- CreateEnum
CREATE TYPE "ServicePlanStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "TaskResponseType" AS ENUM ('done_na_problem', 'yes_no', 'count', 'option', 'text', 'date', 'signature', 'evidence', 'stock_level');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "type" "ClientType" NOT NULL DEFAULT 'commercial',
    "status" "CommercialStatus" NOT NULL DEFAULT 'active',
    "billingEmail" TEXT,
    "phone" TEXT,
    "externalId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "status" "CommercialStatus" NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "completionPolicy" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CommercialStatus" NOT NULL DEFAULT 'active',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postalCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'IE',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Dublin',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "coordinateAccuracyM" INTEGER,
    "coordinateSource" "CoordinateSource" NOT NULL DEFAULT 'manual',
    "geofenceVerifiedM" INTEGER NOT NULL DEFAULT 150,
    "geofenceNearM" INTEGER NOT NULL DEFAULT 250,
    "geofenceSuspiciousM" INTEGER NOT NULL DEFAULT 700,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_sites" (
    "contractId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_sites_pkey" PRIMARY KEY ("contractId","siteId")
);

-- CreateTable
CREATE TABLE "site_access" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "accessWindows" JSONB,
    "entryInstructions" TEXT,
    "keyInstructions" TEXT,
    "alarmInstructions" TEXT,
    "parkingInstructions" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "hazards" JSONB,
    "equipment" JSONB,
    "securityCloseDown" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "type" "AreaType" NOT NULL DEFAULT 'room',
    "code" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requireStartPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requireFinishPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requireSignature" BOOLEAN NOT NULL DEFAULT false,
    "requireProblemPhoto" BOOLEAN NOT NULL DEFAULT true,
    "minimumPhotoCount" INTEGER NOT NULL DEFAULT 0,
    "rules" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT,
    "siteId" TEXT NOT NULL,
    "evidencePolicyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ServicePlanStatus" NOT NULL DEFAULT 'draft',
    "expectedDurationMinutes" INTEGER NOT NULL,
    "requiredWorkers" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "servicePlanId" TEXT NOT NULL,
    "areaId" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "responseType" "TaskResponseType" NOT NULL DEFAULT 'done_na_problem',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "evidenceVisibility" TEXT NOT NULL DEFAULT 'internal',
    "options" JSONB,
    "conditionalRules" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_plan_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "servicePlanId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "expectedDurationMinutes" INTEGER NOT NULL,
    "requiredWorkers" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT NOT NULL,

    CONSTRAINT "service_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_plan_version_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "sourceAreaId" TEXT,
    "areaName" TEXT,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "responseType" "TaskResponseType" NOT NULL,
    "critical" BOOLEAN NOT NULL,
    "required" BOOLEAN NOT NULL,
    "evidenceRequired" BOOLEAN NOT NULL,
    "evidenceVisibility" TEXT NOT NULL,
    "options" JSONB,
    "conditionalRules" JSONB,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "service_plan_version_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_organizationId_status_displayName_idx" ON "clients"("organizationId", "status", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "clients_organizationId_externalId_key" ON "clients"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "contacts_clientId_isPrimary_idx" ON "contacts"("clientId", "isPrimary");

-- CreateIndex
CREATE INDEX "contracts_organizationId_clientId_status_idx" ON "contracts"("organizationId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_organizationId_reference_key" ON "contracts"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "sites_organizationId_clientId_status_idx" ON "sites"("organizationId", "clientId", "status");

-- CreateIndex
CREATE INDEX "sites_organizationId_postalCode_idx" ON "sites"("organizationId", "postalCode");

-- CreateIndex
CREATE INDEX "contract_sites_siteId_idx" ON "contract_sites"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "site_access_siteId_key" ON "site_access"("siteId");

-- CreateIndex
CREATE INDEX "areas_organizationId_siteId_parentId_sortOrder_idx" ON "areas"("organizationId", "siteId", "parentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "areas_siteId_code_key" ON "areas"("siteId", "code");

-- CreateIndex
CREATE INDEX "evidence_policies_organizationId_archivedAt_idx" ON "evidence_policies"("organizationId", "archivedAt");

-- CreateIndex
CREATE INDEX "service_plans_organizationId_siteId_status_idx" ON "service_plans"("organizationId", "siteId", "status");

-- CreateIndex
CREATE INDEX "service_plans_organizationId_contractId_idx" ON "service_plans"("organizationId", "contractId");

-- CreateIndex
CREATE INDEX "task_templates_organizationId_servicePlanId_areaId_sortOrde_idx" ON "task_templates"("organizationId", "servicePlanId", "areaId", "sortOrder");

-- CreateIndex
CREATE INDEX "service_plan_versions_organizationId_publishedAt_idx" ON "service_plan_versions"("organizationId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "service_plan_versions_servicePlanId_versionNumber_key" ON "service_plan_versions"("servicePlanId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "service_plan_versions_servicePlanId_contentHash_key" ON "service_plan_versions"("servicePlanId", "contentHash");

-- CreateIndex
CREATE INDEX "service_plan_version_tasks_organizationId_versionId_sortOrd_idx" ON "service_plan_version_tasks"("organizationId", "versionId", "sortOrder");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sites" ADD CONSTRAINT "contract_sites_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sites" ADD CONSTRAINT "contract_sites_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_access" ADD CONSTRAINT "site_access_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_policies" ADD CONSTRAINT "evidence_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_evidencePolicyId_fkey" FOREIGN KEY ("evidencePolicyId") REFERENCES "evidence_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "service_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plan_versions" ADD CONSTRAINT "service_plan_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plan_versions" ADD CONSTRAINT "service_plan_versions_servicePlanId_fkey" FOREIGN KEY ("servicePlanId") REFERENCES "service_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plan_version_tasks" ADD CONSTRAINT "service_plan_version_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_plan_version_tasks" ADD CONSTRAINT "service_plan_version_tasks_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "service_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "capability_grants_organizationId_capability_scopeType_scopeId_i" RENAME TO "capability_grants_organizationId_capability_scopeType_scope_idx";
