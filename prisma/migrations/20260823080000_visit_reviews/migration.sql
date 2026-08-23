ALTER TABLE "visits" ADD COLUMN "reopenedAt" TIMESTAMP(3);
ALTER TABLE "visits" ADD COLUMN "reopenReason" TEXT;

CREATE TABLE "visit_reviews" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "visitId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "note" TEXT,
  "reviewedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visit_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_reviews_organizationId_visitId_createdAt_idx" ON "visit_reviews"("organizationId", "visitId", "createdAt");
CREATE INDEX "visit_reviews_organizationId_decision_createdAt_idx" ON "visit_reviews"("organizationId", "decision", "createdAt");
ALTER TABLE "visit_reviews" ADD CONSTRAINT "visit_reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_reviews" ADD CONSTRAINT "visit_reviews_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_reviews" ADD CONSTRAINT "visit_reviews_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
