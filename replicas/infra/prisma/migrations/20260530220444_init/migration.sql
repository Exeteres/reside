-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('PROVISION_POSTGRES_DATABASE', 'PROVISION_TEMPORAL_NAMESPACE', 'PROVISION_STORAGE_BUCKET', 'ENSURE_GATEWAY');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Gateway" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "ownerReplicaName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

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
    "gatewayId" INTEGER,
    "storageBucketId" INTEGER,
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
CREATE TABLE "StorageBucket" (
    "id" SERIAL NOT NULL,
    "replicaNamespace" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "provisionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBucket_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "Gateway_name_key" ON "Gateway"("name");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostgresDatabase_database_key" ON "PostgresDatabase"("database");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_replicaNamespace_key" ON "StorageBucket"("replicaNamespace");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_bucket_key" ON "StorageBucket"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_accessKey_key" ON "StorageBucket"("accessKey");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalNamespace_namespace_key" ON "TemporalNamespace"("namespace");

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_temporalNamespaceId_fkey" FOREIGN KEY ("temporalNamespaceId") REFERENCES "TemporalNamespace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_postgresDatabaseId_fkey" FOREIGN KEY ("postgresDatabaseId") REFERENCES "PostgresDatabase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_storageBucketId_fkey" FOREIGN KEY ("storageBucketId") REFERENCES "StorageBucket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
