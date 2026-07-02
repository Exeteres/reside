-- CreateEnum
CREATE TYPE "PostgresDatabaseKind" AS ENUM ('REPLICA', 'TEMPORARY');

-- AlterEnum
ALTER TYPE "OperationType" ADD VALUE 'PROVISION_TEMPORARY_POSTGRES_DATABASE';

-- AlterTable
ALTER TABLE "PostgresDatabase" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "kind" "PostgresDatabaseKind" NOT NULL DEFAULT 'REPLICA',
ADD COLUMN     "ownerReplicaName" TEXT;

-- CreateIndex
CREATE INDEX "PostgresDatabase_kind_expiresAt_idx" ON "PostgresDatabase"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "PostgresDatabase_ownerReplicaName_idx" ON "PostgresDatabase"("ownerReplicaName");
