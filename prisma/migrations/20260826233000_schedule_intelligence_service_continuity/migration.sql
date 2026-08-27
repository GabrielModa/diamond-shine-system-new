-- Schedule Intelligence & Service Continuity
-- Additive/forward-only migration: service obligations remain independent from visits and staffing.

CREATE TYPE "ServicePauseScope" AS ENUM ('client', 'site', 'job');

ALTER TABLE "jobs" ADD COLUMN "generatedThrough" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN "servicePauseId" TEXT;

CREATE TABLE "job_default_assignees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_default_assignees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_pauses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" "ServicePauseScope" NOT NULL,
    "clientId" TEXT,
    "siteId" TEXT,
    "jobId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Dublin',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "endedEarlyAt" TIMESTAMP(3),
    "endedEarlyById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_pauses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_pauses_valid_window" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "service_pauses_exact_scope" CHECK (
      ("scope" = 'client' AND "clientId" IS NOT NULL AND "siteId" IS NULL AND "jobId" IS NULL) OR
      ("scope" = 'site' AND "clientId" IS NULL AND "siteId" IS NOT NULL AND "jobId" IS NULL) OR
      ("scope" = 'job' AND "clientId" IS NULL AND "siteId" IS NULL AND "jobId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "job_default_assignees_jobId_userId_key" ON "job_default_assignees"("jobId", "userId");
CREATE INDEX "job_default_assignees_organizationId_jobId_priority_idx" ON "job_default_assignees"("organizationId", "jobId", "priority");
CREATE INDEX "job_default_assignees_organizationId_userId_idx" ON "job_default_assignees"("organizationId", "userId");
CREATE INDEX "service_pauses_organizationId_startsAt_endsAt_idx" ON "service_pauses"("organizationId", "startsAt", "endsAt");
CREATE INDEX "service_pauses_organizationId_clientId_startsAt_idx" ON "service_pauses"("organizationId", "clientId", "startsAt");
CREATE INDEX "service_pauses_organizationId_siteId_startsAt_idx" ON "service_pauses"("organizationId", "siteId", "startsAt");
CREATE INDEX "service_pauses_organizationId_jobId_startsAt_idx" ON "service_pauses"("organizationId", "jobId", "startsAt");
CREATE INDEX "visits_organizationId_servicePauseId_scheduledStart_idx" ON "visits"("organizationId", "servicePauseId", "scheduledStart");
CREATE INDEX "visits_organizationId_generationKey_idx" ON "visits"("organizationId", "generationKey");

ALTER TABLE "job_default_assignees" ADD CONSTRAINT "job_default_assignees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_default_assignees" ADD CONSTRAINT "job_default_assignees_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_default_assignees" ADD CONSTRAINT "job_default_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_pauses" ADD CONSTRAINT "service_pauses_endedEarlyById_fkey" FOREIGN KEY ("endedEarlyById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_servicePauseId_fkey" FOREIGN KEY ("servicePauseId") REFERENCES "service_pauses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
