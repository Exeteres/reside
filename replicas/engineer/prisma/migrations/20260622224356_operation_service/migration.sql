-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('DELETE_SOURCE_CODE');

-- CreateTable
CREATE TABLE "Operation" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "OperationStatus" NOT NULL,
    "failureReason" TEXT,
    "failureMessage" TEXT,
    "callbackEndpoint" TEXT,
    "customData" JSONB,
    "type" "OperationType" NOT NULL,
    "reaperActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operation_reaperActionId_key" ON "Operation"("reaperActionId");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");
