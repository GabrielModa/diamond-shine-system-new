ALTER TABLE "workforce_profiles"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "employmentStartDate" TIMESTAMP(3),
  ADD COLUMN "weeklyTargetConfigured" BOOLEAN NOT NULL DEFAULT false;

-- Rows that already existed were deliberately configured before this flag existed.
UPDATE "workforce_profiles"
SET "weeklyTargetConfigured" = true;
