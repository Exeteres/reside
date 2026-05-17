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

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_replicaNamespace_key" ON "StorageBucket"("replicaNamespace");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_bucket_key" ON "StorageBucket"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBucket_accessKey_key" ON "StorageBucket"("accessKey");
