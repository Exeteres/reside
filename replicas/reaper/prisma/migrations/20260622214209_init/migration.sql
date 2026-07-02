-- CreateTable
CREATE TABLE "EncryptedContent" (
    "ecid" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "EncryptedContent_pkey" PRIMARY KEY ("ecid")
);

-- CreateTable
CREATE TABLE "ReaperHandler" (
    "id" SERIAL NOT NULL,
    "resourceReplicaName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "callbackEndpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReaperHandler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryNote" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReaperHandler_resourceReplicaName_key" ON "ReaperHandler"("resourceReplicaName");
