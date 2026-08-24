-- CreateTable
CREATE TABLE "site_preferred_assignees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_preferred_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_preferred_assignees_organizationId_siteId_priority_idx" ON "site_preferred_assignees"("organizationId", "siteId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "site_preferred_assignees_siteId_userId_key" ON "site_preferred_assignees"("siteId", "userId");

-- AddForeignKey
ALTER TABLE "site_preferred_assignees" ADD CONSTRAINT "site_preferred_assignees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_preferred_assignees" ADD CONSTRAINT "site_preferred_assignees_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_preferred_assignees" ADD CONSTRAINT "site_preferred_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
