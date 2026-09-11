CREATE INDEX "visits_organizationId_status_scheduledStart_idx"
ON "visits"("organizationId", "status", "scheduledStart");

CREATE INDEX "supply_requests_organizationId_dueAt_createdAt_idx"
ON "supply_requests"("organizationId", "dueAt", "createdAt");

CREATE INDEX "supply_requests_organizationId_status_dueAt_createdAt_idx"
ON "supply_requests"("organizationId", "status", "dueAt", "createdAt");

CREATE INDEX "service_plans_organizationId_archivedAt_updatedAt_idx"
ON "service_plans"("organizationId", "archivedAt", "updatedAt");

CREATE INDEX "sites_organizationId_archivedAt_name_idx"
ON "sites"("organizationId", "archivedAt", "name");

CREATE INDEX "operational_notices_organizationId_priority_publishedAt_idx"
ON "operational_notices"("organizationId", "priority", "publishedAt");

CREATE INDEX "audit_logs_organizationId_targetType_createdAt_idx"
ON "audit_logs"("organizationId", "targetType", "createdAt");
