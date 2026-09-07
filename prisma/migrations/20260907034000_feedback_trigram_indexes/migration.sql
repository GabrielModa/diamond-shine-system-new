CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "feedback_entries_employeeName_trgm_idx"
  ON "feedback_entries" USING GIN ("employeeName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "feedback_entries_clientLocation_trgm_idx"
  ON "feedback_entries" USING GIN ("clientLocation" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "feedback_entries_comments_trgm_idx"
  ON "feedback_entries" USING GIN ("comments" gin_trgm_ops);
