CREATE INDEX "feedback_entries_organizationId_submittedBy_createdAt_idx" ON "feedback_entries"("organizationId", "submittedBy", "createdAt");
CREATE INDEX "feedback_entries_organizationId_employeeName_createdAt_idx" ON "feedback_entries"("organizationId", "employeeName", "createdAt");
CREATE INDEX "feedback_entries_organizationId_category_createdAt_idx" ON "feedback_entries"("organizationId", "category", "createdAt");
