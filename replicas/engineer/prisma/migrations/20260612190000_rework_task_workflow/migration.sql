ALTER TABLE "Task" ADD COLUMN "topicId" TEXT NOT NULL;
ALTER TABLE "Task" ADD COLUMN "previewTitle" TEXT NOT NULL;
ALTER TABLE "Task" ADD COLUMN "progressNotificationId" TEXT;

CREATE UNIQUE INDEX "Task_topicId_key" ON "Task"("topicId");
