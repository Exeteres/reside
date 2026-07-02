-- AlterTable
ALTER TABLE "Command" ADD COLUMN     "ownerReplicaName" TEXT;

-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN     "ownerReplicaName" TEXT;

-- CreateIndex
CREATE INDEX "Command_ownerReplicaName_idx" ON "Command"("ownerReplicaName");

-- CreateIndex
CREATE INDEX "NotificationChannel_ownerReplicaName_idx" ON "NotificationChannel"("ownerReplicaName");
