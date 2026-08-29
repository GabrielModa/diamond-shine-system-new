-- Employee-owned recurring weekly unavailability (other job, care, regular commitments, etc.).
CREATE TABLE "recurring_unavailability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startsMinute" INTEGER NOT NULL,
    "endsMinute" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recurring_unavailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recurring_unavailability_organizationId_profileId_dayOfWeek_idx"
ON "recurring_unavailability"("organizationId", "profileId", "dayOfWeek");

ALTER TABLE "recurring_unavailability"
ADD CONSTRAINT "recurring_unavailability_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recurring_unavailability"
ADD CONSTRAINT "recurring_unavailability_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "workforce_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
