-- AlterEnum
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'PROVISION_STORAGE_BUCKET';

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN "storageBucketId" INTEGER;

-- CreateIndex
CREATE INDEX "Operation_storageBucketId_idx" ON "Operation"("storageBucketId");

-- AddForeignKey
ALTER TABLE "Operation"
ADD CONSTRAINT "Operation_storageBucketId_fkey"
FOREIGN KEY ("storageBucketId") REFERENCES "StorageBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
