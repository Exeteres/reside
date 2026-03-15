-- CreateTable
CREATE TABLE "Replica" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "internalEndpoint" TEXT NOT NULL,
    "publicEndpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Replica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplicaDependencySlot" (
    "id" SERIAL NOT NULL,
    "replicaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "defaultReplicaId" INTEGER,
    "currentReplicaId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplicaDependencySlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplicaEndpointDependencySlot" (
    "id" SERIAL NOT NULL,
    "replicaId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "defaultEndpoint" TEXT,
    "currentEndpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplicaEndpointDependencySlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Replica_name_key" ON "Replica"("name");

-- CreateIndex
CREATE INDEX "ReplicaDependencySlot_replicaId_idx" ON "ReplicaDependencySlot"("replicaId");

-- CreateIndex
CREATE INDEX "ReplicaDependencySlot_defaultReplicaId_idx" ON "ReplicaDependencySlot"("defaultReplicaId");

-- CreateIndex
CREATE INDEX "ReplicaDependencySlot_currentReplicaId_idx" ON "ReplicaDependencySlot"("currentReplicaId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplicaDependencySlot_replicaId_name_key" ON "ReplicaDependencySlot"("replicaId", "name");

-- CreateIndex
CREATE INDEX "ReplicaEndpointDependencySlot_replicaId_idx" ON "ReplicaEndpointDependencySlot"("replicaId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplicaEndpointDependencySlot_replicaId_name_key" ON "ReplicaEndpointDependencySlot"("replicaId", "name");

-- AddForeignKey
ALTER TABLE "ReplicaDependencySlot" ADD CONSTRAINT "ReplicaDependencySlot_replicaId_fkey" FOREIGN KEY ("replicaId") REFERENCES "Replica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicaDependencySlot" ADD CONSTRAINT "ReplicaDependencySlot_defaultReplicaId_fkey" FOREIGN KEY ("defaultReplicaId") REFERENCES "Replica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicaDependencySlot" ADD CONSTRAINT "ReplicaDependencySlot_currentReplicaId_fkey" FOREIGN KEY ("currentReplicaId") REFERENCES "Replica"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplicaEndpointDependencySlot" ADD CONSTRAINT "ReplicaEndpointDependencySlot_replicaId_fkey" FOREIGN KEY ("replicaId") REFERENCES "Replica"("id") ON DELETE CASCADE ON UPDATE CASCADE;
