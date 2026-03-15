-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

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
    "replicaName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE INDEX "Operation_replicaName_status_idx" ON "Operation"("replicaName", "status");

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_replicaName_fkey" FOREIGN KEY ("replicaName") REFERENCES "Replica"("name") ON DELETE SET NULL ON UPDATE CASCADE;
