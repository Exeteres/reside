-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('APPROVE_PERMISSION_REQUEST_SET');

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN     "type" "OperationType";

-- Backfill existing operations created before operation types were introduced.
UPDATE "Operation"
SET "type" = 'APPROVE_PERMISSION_REQUEST_SET'
WHERE "type" IS NULL;

-- AlterTable
ALTER TABLE "Operation" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");
