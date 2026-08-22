-- CreateEnum
CREATE TYPE "OperationalNoticeType" AS ENUM ('schedule_change', 'site_instruction', 'incident', 'materials', 'quality', 'general');

-- CreateEnum
CREATE TYPE "OperationalNoticePriority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateTable
CREATE TABLE "operational_notices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT,
    "visitId" TEXT,
    "type" "OperationalNoticeType" NOT NULL DEFAULT 'general',
    "priority" "OperationalNoticePriority" NOT NULL DEFAULT 'normal',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_notice_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operational_notice_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operational_notices_organizationId_publishedAt_idx" ON "operational_notices"("organizationId", "publishedAt");

-- CreateIndex
CREATE INDEX "operational_notices_organizationId_siteId_publishedAt_idx" ON "operational_notices"("organizationId", "siteId", "publishedAt");

-- CreateIndex
CREATE INDEX "operational_notices_organizationId_visitId_idx" ON "operational_notices"("organizationId", "visitId");

-- CreateIndex
CREATE INDEX "operational_notice_recipients_organizationId_userId_acknowl_idx" ON "operational_notice_recipients"("organizationId", "userId", "acknowledgedAt", "deliveredAt");

-- CreateIndex
CREATE INDEX "operational_notice_recipients_organizationId_noticeId_ackno_idx" ON "operational_notice_recipients"("organizationId", "noticeId", "acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "operational_notice_recipients_noticeId_userId_key" ON "operational_notice_recipients"("noticeId", "userId");

-- AddForeignKey
ALTER TABLE "operational_notices" ADD CONSTRAINT "operational_notices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notices" ADD CONSTRAINT "operational_notices_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notices" ADD CONSTRAINT "operational_notices_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notices" ADD CONSTRAINT "operational_notices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notice_recipients" ADD CONSTRAINT "operational_notice_recipients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notice_recipients" ADD CONSTRAINT "operational_notice_recipients_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "operational_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_notice_recipients" ADD CONSTRAINT "operational_notice_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
