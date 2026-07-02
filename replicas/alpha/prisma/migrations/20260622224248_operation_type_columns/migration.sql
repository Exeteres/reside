-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('WAIT_REPLICA_READY', 'UNREGISTER_REPLICA', 'DELETE_REPLICA_FROM_CLUSTER');

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN     "reaperActionId" TEXT,
ADD COLUMN     "type" "OperationType";

-- Backfill existing operations created before operation types were introduced.
UPDATE "Operation" SET "type" = 'WAIT_REPLICA_READY' WHERE "type" IS NULL;

-- AlterTable
ALTER TABLE "Operation" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Operation_reaperActionId_key" ON "Operation"("reaperActionId");

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");
