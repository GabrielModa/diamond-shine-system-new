CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE "MembershipRole" AS ENUM ('organization_admin', 'field_supervisor', 'scheduler', 'employee', 'stock_controller', 'quality_inspector', 'finance', 'viewer');
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE "ScopeType" AS ENUM ('organization', 'region', 'contract', 'site', 'self');

CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Dublin',
  "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

INSERT INTO "organizations" ("id", "name", "slug", "timezone", "status", "createdAt", "updatedAt")
VALUES ('org_legacy_diamond_shine', 'Diamond Shine', 'diamond-shine', 'Europe/Dublin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "memberships" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capability_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "scopeType" "ScopeType" NOT NULL DEFAULT 'organization',
  "scopeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "capability_grants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "audit_logs" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "email_templates" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "notification_settings" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "supply_requests" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "feedback_entries" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "notification_jobs" ADD COLUMN "organizationId" TEXT;

UPDATE "audit_logs" SET "organizationId" = 'org_legacy_diamond_shine';
UPDATE "email_templates" SET "organizationId" = 'org_legacy_diamond_shine';
UPDATE "notification_settings" SET "organizationId" = 'org_legacy_diamond_shine';
UPDATE "supply_requests" SET "organizationId" = 'org_legacy_diamond_shine';
UPDATE "feedback_entries" SET "organizationId" = 'org_legacy_diamond_shine';
UPDATE "notification_jobs" SET "organizationId" = 'org_legacy_diamond_shine';

ALTER TABLE "audit_logs" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "email_templates" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "notification_settings" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "supply_requests" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "feedback_entries" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "notification_jobs" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "audit_logs" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
ALTER TABLE "email_templates" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
ALTER TABLE "notification_settings" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
ALTER TABLE "supply_requests" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
ALTER TABLE "feedback_entries" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
ALTER TABLE "notification_jobs" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';

INSERT INTO "memberships" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT 'mem_' || "id", 'org_legacy_diamond_shine', "id",
  CASE "role"::text
    WHEN 'admin' THEN 'organization_admin'::"MembershipRole"
    WHEN 'supervisor' THEN 'field_supervisor'::"MembershipRole"
    WHEN 'employee' THEN 'employee'::"MembershipRole"
    ELSE 'viewer'::"MembershipRole"
  END,
  CASE WHEN "status" = 'active' THEN 'active'::"MembershipStatus" ELSE 'invited'::"MembershipStatus" END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users";

CREATE UNIQUE INDEX "memberships_organizationId_userId_key" ON "memberships"("organizationId", "userId");
CREATE INDEX "memberships_userId_status_idx" ON "memberships"("userId", "status");
CREATE INDEX "memberships_organizationId_role_status_idx" ON "memberships"("organizationId", "role", "status");
CREATE UNIQUE INDEX "capability_grants_membershipId_capability_scopeType_scopeId_key" ON "capability_grants"("membershipId", "capability", "scopeType", "scopeId");
CREATE INDEX "capability_grants_organizationId_capability_scopeType_scopeId_idx" ON "capability_grants"("organizationId", "capability", "scopeType", "scopeId");
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");
CREATE INDEX "email_templates_organizationId_idx" ON "email_templates"("organizationId");
CREATE INDEX "notification_settings_organizationId_idx" ON "notification_settings"("organizationId");
CREATE INDEX "supply_requests_organizationId_createdAt_idx" ON "supply_requests"("organizationId", "createdAt");
CREATE INDEX "feedback_entries_organizationId_createdAt_idx" ON "feedback_entries"("organizationId", "createdAt");
CREATE INDEX "notification_jobs_organizationId_status_nextAttemptAt_idx" ON "notification_jobs"("organizationId", "status", "nextAttemptAt");
CREATE INDEX "notification_jobs_organizationId_createdAt_idx" ON "notification_jobs"("organizationId", "createdAt");

DROP INDEX IF EXISTS "email_templates_key_key";
DROP INDEX IF EXISTS "notification_settings_key_key";
CREATE UNIQUE INDEX "email_templates_organizationId_key_key" ON "email_templates"("organizationId", "key");
CREATE UNIQUE INDEX "notification_settings_organizationId_key_key" ON "notification_settings"("organizationId", "key");

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capability_grants" ADD CONSTRAINT "capability_grants_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_entries" ADD CONSTRAINT "feedback_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
