ALTER TABLE "auth_tokens" ADD COLUMN "organizationId" TEXT;
UPDATE "auth_tokens" SET "organizationId" = 'org_legacy_diamond_shine';
ALTER TABLE "auth_tokens" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "auth_tokens" ALTER COLUMN "organizationId" SET DEFAULT 'org_legacy_diamond_shine';
CREATE INDEX "auth_tokens_organizationId_type_idx" ON "auth_tokens"("organizationId", "type");
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
