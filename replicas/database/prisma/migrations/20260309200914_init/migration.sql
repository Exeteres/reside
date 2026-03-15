-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('PROVISION_POSTGRES_DATABASE', 'PROVISION_TEMPORAL_NAMESPACE');

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
    "type" "OperationType" NOT NULL,
    "temporalNamespaceId" INTEGER,
    "postgresDatabaseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostgresDatabase" (
    "id" SERIAL NOT NULL,
    "database" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostgresDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalNamespace" (
    "id" SERIAL NOT NULL,
    "namespace" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalNamespace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostgresDatabase_database_key" ON "PostgresDatabase"("database");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalNamespace_namespace_key" ON "TemporalNamespace"("namespace");

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_temporalNamespaceId_fkey" FOREIGN KEY ("temporalNamespaceId") REFERENCES "TemporalNamespace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_postgresDatabaseId_fkey" FOREIGN KEY ("postgresDatabaseId") REFERENCES "PostgresDatabase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
