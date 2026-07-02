/*
  Warnings:

  - A unique constraint covering the columns `[reaperActionId]` on the table `Operation` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('NOTIFICATION_RESPONSE', 'APPROVAL_REQUEST', 'AVATAR_PROVISION', 'DELETE_AVATAR');

-- DropForeignKey
ALTER TABLE "AvatarProvisionRequest" DROP CONSTRAINT "AvatarProvisionRequest_avatarId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_channelId_fkey";

-- AlterTable
ALTER TABLE "Operation" ADD COLUMN     "notificationResponseContextToken" TEXT,
ADD COLUMN     "reaperActionId" TEXT,
ADD COLUMN     "type" "OperationType";

-- Backfill existing operations created before operation types were introduced.
UPDATE "Operation"
SET "type" = 'APPROVAL_REQUEST'
WHERE "id" IN (SELECT "operationId" FROM "ApprovalRequest");

UPDATE "Operation"
SET "type" = 'AVATAR_PROVISION'
WHERE "id" IN (SELECT "operationId" FROM "AvatarProvisionRequest");

UPDATE "Operation"
SET "type" = 'NOTIFICATION_RESPONSE'
WHERE "type" IS NULL;

-- AlterTable
ALTER TABLE "Operation" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AvatarProvisionRequest_replicaName_idx" ON "AvatarProvisionRequest"("replicaName");

-- CreateIndex
CREATE INDEX "NaturalLanguageInteraction_replicaName_idx" ON "NaturalLanguageInteraction"("replicaName");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_reaperActionId_key" ON "Operation"("reaperActionId");

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");

-- AddForeignKey
ALTER TABLE "AvatarProvisionRequest" ADD CONSTRAINT "AvatarProvisionRequest_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
