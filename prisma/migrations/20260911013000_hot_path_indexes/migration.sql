CREATE INDEX "time_entries_organizationId_startedAt_status_idx"
ON "time_entries"("organizationId", "startedAt", "status");

CREATE INDEX "time_entries_organizationId_status_startedAt_idx"
ON "time_entries"("organizationId", "status", "startedAt");

CREATE INDEX "location_events_organizationId_timeEntryId_kind_capturedAt_idx"
ON "location_events"("organizationId", "timeEntryId", "kind", "capturedAt");
