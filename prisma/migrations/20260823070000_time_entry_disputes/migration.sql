CREATE TABLE "time_entry_disputes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "timeEntryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolution" TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "time_entry_disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "time_entry_disputes_organizationId_status_createdAt_idx"
  ON "time_entry_disputes"("organizationId", "status", "createdAt");
CREATE INDEX "time_entry_disputes_organizationId_timeEntryId_idx"
  ON "time_entry_disputes"("organizationId", "timeEntryId");
CREATE INDEX "time_entry_disputes_organizationId_userId_createdAt_idx"
  ON "time_entry_disputes"("organizationId", "userId", "createdAt");

ALTER TABLE "time_entry_disputes"
  ADD CONSTRAINT "time_entry_disputes_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_entry_disputes"
  ADD CONSTRAINT "time_entry_disputes_timeEntryId_fkey"
  FOREIGN KEY ("timeEntryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entry_disputes"
  ADD CONSTRAINT "time_entry_disputes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
