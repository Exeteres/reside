-- AlterEnum
ALTER TYPE "OperationType" ADD VALUE 'ENSURE_GATEWAY';

-- CreateTable
CREATE TABLE "Gateway" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ownerReplicaName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "paths" JSONB NOT NULL,
    "endpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_name_key" ON "Gateway"("name");

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN "gatewayId" INTEGER;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
