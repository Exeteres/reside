-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('APPROVAL_REQUEST');

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN     "type" "OperationType";

-- Backfill existing operations created before operation types were introduced.
UPDATE "Operation" SET "type" = 'APPROVAL_REQUEST' WHERE "type" IS NULL;

-- AlterTable
ALTER TABLE "Operation" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");
