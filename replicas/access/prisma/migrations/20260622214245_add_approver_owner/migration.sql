-- AlterTable
ALTER TABLE "Approver" ADD COLUMN     "ownerReplicaName" TEXT;

-- CreateIndex
CREATE INDEX "Approver_ownerReplicaName_idx" ON "Approver"("ownerReplicaName");
