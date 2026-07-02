/*
  Warnings:

  - A unique constraint covering the columns `[reaperActionId]` on the table `Operation` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OperationType" ADD VALUE 'DELETE_POSTGRES_DATABASE';
ALTER TYPE "OperationType" ADD VALUE 'DELETE_TEMPORAL_NAMESPACE';
ALTER TYPE "OperationType" ADD VALUE 'DELETE_GATEWAY';
ALTER TYPE "OperationType" ADD VALUE 'DELETE_STORAGE_BUCKET';

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN     "reaperActionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Operation_reaperActionId_key" ON "Operation"("reaperActionId");

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");
