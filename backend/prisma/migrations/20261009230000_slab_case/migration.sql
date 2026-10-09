-- Slab/case domain model for Aquageno (packing configurations, case-split
-- production, case-based transfer/shipment lines, traceability links).

-- PackingConfiguration: one finished item = one packing configuration.
CREATE TABLE "PackingConfiguration" (
    "id" TEXT NOT NULL,
    "finishedItemId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "slabWeightKg" DECIMAL(18,3) NOT NULL,
    "slabsPerCase" INTEGER NOT NULL,
    "tareWeightKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PackingConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PackingConfiguration_finishedItemId_key" ON "PackingConfiguration"("finishedItemId");
CREATE INDEX "PackingConfiguration_finishedItemId_idx" ON "PackingConfiguration"("finishedItemId");
ALTER TABLE "PackingConfiguration" ADD CONSTRAINT "PackingConfiguration_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Production: slab/case split recorded at posting time.
ALTER TABLE "Production" ADD COLUMN "slabsProduced" DECIMAL(18,3);
ALTER TABLE "Production" ADD COLUMN "casesProduced" INTEGER;
ALTER TABLE "Production" ADD COLUMN "looseSlabs" DECIMAL(18,3);
ALTER TABLE "Production" ADD COLUMN "netWeightKg" DECIMAL(18,3);

-- TransferLine: optional case-based entry (converted to slabs for stock).
ALTER TABLE "TransferLine" ADD COLUMN "cases" DECIMAL(18,3);
ALTER TABLE "TransferLine" ADD COLUMN "looseSlabs" DECIMAL(18,3);

-- ShipmentLine: optional case-based entry with derived net weight.
ALTER TABLE "ShipmentLine" ADD COLUMN "cases" DECIMAL(18,3);
ALTER TABLE "ShipmentLine" ADD COLUMN "looseSlabs" DECIMAL(18,3);
ALTER TABLE "ShipmentLine" ADD COLUMN "netWeightKg" DECIMAL(18,3);

-- Traceability: purchases that fed a production batch.
CREATE TABLE "ProductionSource" (
    "productionId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    CONSTRAINT "ProductionSource_pkey" PRIMARY KEY ("productionId","purchaseId")
);
CREATE INDEX "ProductionSource_purchaseId_idx" ON "ProductionSource"("purchaseId");
ALTER TABLE "ProductionSource" ADD CONSTRAINT "ProductionSource_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionSource" ADD CONSTRAINT "ProductionSource_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Traceability: production batches that fed a shipment.
CREATE TABLE "ShipmentSource" (
    "shipmentId" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    CONSTRAINT "ShipmentSource_pkey" PRIMARY KEY ("shipmentId","productionId")
);
CREATE INDEX "ShipmentSource_productionId_idx" ON "ShipmentSource"("productionId");
ALTER TABLE "ShipmentSource" ADD CONSTRAINT "ShipmentSource_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentSource" ADD CONSTRAINT "ShipmentSource_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
