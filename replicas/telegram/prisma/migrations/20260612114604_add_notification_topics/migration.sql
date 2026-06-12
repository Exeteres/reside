-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "acquireTopic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topicId" INTEGER;

-- CreateTable
CREATE TABLE "NotificationChannelBinding" (
    "id" SERIAL NOT NULL,
    "channelId" INTEGER NOT NULL,
    "chatId" INTEGER NOT NULL,
    "topicId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannelBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTopic" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "channelId" INTEGER NOT NULL,
    "threadRhid" TEXT NOT NULL,
    "threadEcid" TEXT NOT NULL,
    "creatorSubjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTopic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannelBinding_channelId_key" ON "NotificationChannelBinding"("channelId");

-- CreateIndex
CREATE INDEX "NotificationChannelBinding_chatId_idx" ON "NotificationChannelBinding"("chatId");

-- CreateIndex
CREATE INDEX "NotificationChannelBinding_topicId_idx" ON "NotificationChannelBinding"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTopic_threadEcid_key" ON "NotificationTopic"("threadEcid");

-- CreateIndex
CREATE INDEX "NotificationTopic_channelId_idx" ON "NotificationTopic"("channelId");

-- CreateIndex
CREATE INDEX "NotificationTopic_chatId_idx" ON "NotificationTopic"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTopic_chatId_threadRhid_key" ON "NotificationTopic"("chatId", "threadRhid");

-- CreateIndex
CREATE INDEX "Notification_topicId_idx" ON "Notification"("topicId");

-- AddForeignKey
ALTER TABLE "NotificationChannelBinding" ADD CONSTRAINT "NotificationChannelBinding_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannelBinding" ADD CONSTRAINT "NotificationChannelBinding_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannelBinding" ADD CONSTRAINT "NotificationChannelBinding_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NotificationTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTopic" ADD CONSTRAINT "NotificationTopic_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTopic" ADD CONSTRAINT "NotificationTopic_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTopic" ADD CONSTRAINT "NotificationTopic_threadEcid_fkey" FOREIGN KEY ("threadEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NotificationTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
