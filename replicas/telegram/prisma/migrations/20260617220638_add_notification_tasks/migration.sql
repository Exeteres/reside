-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('REGULAR', 'PLANNING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationTaskStatus" AS ENUM ('PLANNED', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "NotificationResponseType" ADD VALUE 'TASK_UPDATE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "status" "NotificationStatus" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "NotificationTaskGroup" (
    "notificationId" INTEGER NOT NULL,
    "stableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "NotificationTaskGroup_pkey" PRIMARY KEY ("notificationId","stableId")
);

-- CreateTable
CREATE TABLE "NotificationTask" (
    "notificationId" INTEGER NOT NULL,
    "groupStableId" TEXT NOT NULL,
    "stableId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "NotificationTaskStatus" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "NotificationTask_pkey" PRIMARY KEY ("notificationId","groupStableId","stableId")
);

-- CreateTable
CREATE TABLE "NotificationTaskPlanningPoll" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "pollRhid" TEXT NOT NULL,
    "messageEcid" TEXT NOT NULL,
    "launchedByUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTaskPlanningPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTaskPlanningPollOption" (
    "pollId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "taskNotificationId" INTEGER NOT NULL,
    "taskGroupStableId" TEXT NOT NULL,
    "taskStableId" TEXT NOT NULL,

    CONSTRAINT "NotificationTaskPlanningPollOption_pkey" PRIMARY KEY ("pollId","optionId")
);

-- CreateIndex
CREATE INDEX "NotificationTaskGroup_notificationId_idx" ON "NotificationTaskGroup"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationTask_notificationId_groupStableId_idx" ON "NotificationTask"("notificationId", "groupStableId");

-- CreateIndex
CREATE INDEX "NotificationTask_status_idx" ON "NotificationTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTaskPlanningPoll_pollRhid_key" ON "NotificationTaskPlanningPoll"("pollRhid");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTaskPlanningPoll_messageEcid_key" ON "NotificationTaskPlanningPoll"("messageEcid");

-- CreateIndex
CREATE INDEX "NotificationTaskPlanningPoll_notificationId_idx" ON "NotificationTaskPlanningPoll"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationTaskPlanningPoll_launchedByUserId_idx" ON "NotificationTaskPlanningPoll"("launchedByUserId");

-- CreateIndex
CREATE INDEX "NotificationTaskPlanningPollOption_taskNotificationId_taskG_idx" ON "NotificationTaskPlanningPollOption"("taskNotificationId", "taskGroupStableId", "taskStableId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTaskPlanningPollOption_pollId_taskNotificationI_key" ON "NotificationTaskPlanningPollOption"("pollId", "taskNotificationId", "taskGroupStableId", "taskStableId");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- AddForeignKey
ALTER TABLE "NotificationTaskGroup" ADD CONSTRAINT "NotificationTaskGroup_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_notificationId_groupStableId_fkey" FOREIGN KEY ("notificationId", "groupStableId") REFERENCES "NotificationTaskGroup"("notificationId", "stableId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTaskPlanningPoll" ADD CONSTRAINT "NotificationTaskPlanningPoll_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTaskPlanningPoll" ADD CONSTRAINT "NotificationTaskPlanningPoll_messageEcid_fkey" FOREIGN KEY ("messageEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTaskPlanningPoll" ADD CONSTRAINT "NotificationTaskPlanningPoll_launchedByUserId_fkey" FOREIGN KEY ("launchedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTaskPlanningPollOption" ADD CONSTRAINT "NotificationTaskPlanningPollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "NotificationTaskPlanningPoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTaskPlanningPollOption" ADD CONSTRAINT "NotificationTaskPlanningPollOption_taskNotificationId_task_fkey" FOREIGN KEY ("taskNotificationId", "taskGroupStableId", "taskStableId") REFERENCES "NotificationTask"("notificationId", "groupStableId", "stableId") ON DELETE CASCADE ON UPDATE CASCADE;
