-- DropForeignKey
ALTER TABLE "Operation" DROP CONSTRAINT "Operation_gatewayId_fkey";

-- DropForeignKey
ALTER TABLE "Operation" DROP CONSTRAINT "Operation_postgresDatabaseId_fkey";

-- DropForeignKey
ALTER TABLE "Operation" DROP CONSTRAINT "Operation_storageBucketId_fkey";

-- DropForeignKey
ALTER TABLE "Operation" DROP CONSTRAINT "Operation_temporalNamespaceId_fkey";

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_temporalNamespaceId_fkey" FOREIGN KEY ("temporalNamespaceId") REFERENCES "TemporalNamespace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_postgresDatabaseId_fkey" FOREIGN KEY ("postgresDatabaseId") REFERENCES "PostgresDatabase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_storageBucketId_fkey" FOREIGN KEY ("storageBucketId") REFERENCES "StorageBucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
