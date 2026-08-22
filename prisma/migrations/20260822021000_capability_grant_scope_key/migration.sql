UPDATE "capability_grants" SET "scopeId" = '' WHERE "scopeId" IS NULL;
ALTER TABLE "capability_grants" ALTER COLUMN "scopeId" SET DEFAULT '';
ALTER TABLE "capability_grants" ALTER COLUMN "scopeId" SET NOT NULL;
