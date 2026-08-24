CREATE TABLE "notification_jobs" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "payload" JSONB NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "createdBy" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_jobs_status_nextAttemptAt_idx" ON "notification_jobs"("status", "nextAttemptAt");
CREATE INDEX "notification_jobs_entityType_entityId_idx" ON "notification_jobs"("entityType", "entityId");
CREATE INDEX "notification_jobs_createdAt_idx" ON "notification_jobs"("createdAt");
