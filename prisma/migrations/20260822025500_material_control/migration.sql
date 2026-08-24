-- AlterTable
ALTER TABLE "supply_request_items" ADD COLUMN     "catalogItemId" TEXT,
ADD COLUMN     "currentQuantity" INTEGER,
ADD COLUMN     "targetQuantity" INTEGER;

-- AlterTable
ALTER TABLE "supply_requests" ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "visitId" TEXT;

-- CreateTable
CREATE TABLE "material_catalog_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultParLevel" INTEGER NOT NULL DEFAULT 10,
    "defaultReorderPoint" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_stock_levels" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "parLevel" INTEGER NOT NULL,
    "reorderPoint" INTEGER NOT NULL,
    "estimatedDailyUse" DECIMAL(10,2),
    "lastCountedAt" TIMESTAMP(3),
    "lastCountedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_stock_counts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "visitId" TEXT,
    "countedBy" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'visit',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_stock_count_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "previousQuantity" INTEGER,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "material_stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_catalog_items_organizationId_active_category_name_idx" ON "material_catalog_items"("organizationId", "active", "category", "name");

-- CreateIndex
CREATE UNIQUE INDEX "material_catalog_items_organizationId_sku_key" ON "material_catalog_items"("organizationId", "sku");

-- CreateIndex
CREATE INDEX "site_stock_levels_organizationId_siteId_onHand_idx" ON "site_stock_levels"("organizationId", "siteId", "onHand");

-- CreateIndex
CREATE UNIQUE INDEX "site_stock_levels_siteId_catalogItemId_key" ON "site_stock_levels"("siteId", "catalogItemId");

-- CreateIndex
CREATE INDEX "material_stock_counts_organizationId_siteId_createdAt_idx" ON "material_stock_counts"("organizationId", "siteId", "createdAt");

-- CreateIndex
CREATE INDEX "material_stock_counts_organizationId_visitId_idx" ON "material_stock_counts"("organizationId", "visitId");

-- CreateIndex
CREATE INDEX "material_stock_count_lines_organizationId_catalogItemId_idx" ON "material_stock_count_lines"("organizationId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "material_stock_count_lines_stockCountId_catalogItemId_key" ON "material_stock_count_lines"("stockCountId", "catalogItemId");

-- CreateIndex
CREATE INDEX "supply_request_items_catalogItemId_idx" ON "supply_request_items"("catalogItemId");

-- CreateIndex
CREATE INDEX "supply_requests_organizationId_siteId_status_idx" ON "supply_requests"("organizationId", "siteId", "status");

-- AddForeignKey
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_requests" ADD CONSTRAINT "supply_requests_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_request_items" ADD CONSTRAINT "supply_request_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "material_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_catalog_items" ADD CONSTRAINT "material_catalog_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_stock_levels" ADD CONSTRAINT "site_stock_levels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_stock_levels" ADD CONSTRAINT "site_stock_levels_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_stock_levels" ADD CONSTRAINT "site_stock_levels_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "material_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_counts" ADD CONSTRAINT "material_stock_counts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_counts" ADD CONSTRAINT "material_stock_counts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_counts" ADD CONSTRAINT "material_stock_counts_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_counts" ADD CONSTRAINT "material_stock_counts_countedBy_fkey" FOREIGN KEY ("countedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_count_lines" ADD CONSTRAINT "material_stock_count_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_count_lines" ADD CONSTRAINT "material_stock_count_lines_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "material_stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_count_lines" ADD CONSTRAINT "material_stock_count_lines_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "material_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
