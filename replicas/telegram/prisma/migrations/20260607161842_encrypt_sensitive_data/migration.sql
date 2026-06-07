/*
  Warnings:

  - You are about to drop the column `token` on the `Avatar` table. All the data in the column will be lost.
  - You are about to drop the column `data` on the `Chat` table. All the data in the column will be lost.
  - You are about to drop the column `telegramId` on the `Chat` table. All the data in the column will be lost.
  - You are about to drop the column `threadId` on the `NaturalLanguageInteraction` table. All the data in the column will be lost.
  - You are about to drop the column `messageId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `replyToMessageId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `targetChatId` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `textResponse` on the `NotificationResponse` table. All the data in the column will be lost.
  - You are about to drop the column `data` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `telegramId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[tokenEcid]` on the table `Avatar` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[telegramRhid]` on the table `Chat` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[dataEcid]` on the table `Chat` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[chatId,threadRhid]` on the table `NaturalLanguageInteraction` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[messageEcid]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[chatId,messageRhid]` on the table `Notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[textResponseEcid]` on the table `NotificationResponse` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[telegramRhid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[dataEcid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tokenEcid` to the `Avatar` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataEcid` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `telegramRhid` to the `Chat` table without a default value. This is not possible if the table is not empty.
  - Added the required column `threadRhid` to the `NaturalLanguageInteraction` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `chatId` on the `NaturalLanguageInteraction` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `chatId` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `messageEcid` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `messageRhid` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataEcid` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `telegramRhid` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "NaturalLanguageInteraction" DROP CONSTRAINT "NaturalLanguageInteraction_chatId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_targetChatId_fkey";

-- DropIndex
DROP INDEX "Chat_telegramId_key";

-- DropIndex
DROP INDEX "NaturalLanguageInteraction_chatId_threadId_key";

-- DropIndex
DROP INDEX "Notification_messageId_idx";

-- DropIndex
DROP INDEX "Notification_targetChatId_idx";

-- DropIndex
DROP INDEX "User_telegramId_key";

-- AlterTable
ALTER TABLE "Avatar" DROP COLUMN "token",
ADD COLUMN     "tokenEcid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "data",
DROP COLUMN "telegramId",
ADD COLUMN     "dataEcid" TEXT NOT NULL,
ADD COLUMN     "telegramRhid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NaturalLanguageInteraction" DROP COLUMN "threadId",
ADD COLUMN     "threadRhid" TEXT NOT NULL,
DROP COLUMN "chatId",
ADD COLUMN     "chatId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "messageId",
DROP COLUMN "replyToMessageId",
DROP COLUMN "targetChatId",
ADD COLUMN     "chatId" INTEGER NOT NULL,
ADD COLUMN     "messageEcid" TEXT NOT NULL,
ADD COLUMN     "messageRhid" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "NotificationResponse" DROP COLUMN "textResponse",
ADD COLUMN     "textResponseEcid" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "data",
DROP COLUMN "telegramId",
ADD COLUMN     "dataEcid" TEXT NOT NULL,
ADD COLUMN     "telegramRhid" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "EncryptedContent" (
    "ecid" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "EncryptedContent_pkey" PRIMARY KEY ("ecid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_tokenEcid_key" ON "Avatar"("tokenEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_telegramRhid_key" ON "Chat"("telegramRhid");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_dataEcid_key" ON "Chat"("dataEcid");

-- CreateIndex
CREATE INDEX "NaturalLanguageInteraction_chatId_userId_idx" ON "NaturalLanguageInteraction"("chatId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NaturalLanguageInteraction_chatId_threadRhid_key" ON "NaturalLanguageInteraction"("chatId", "threadRhid");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_messageEcid_key" ON "Notification"("messageEcid");

-- CreateIndex
CREATE INDEX "Notification_chatId_idx" ON "Notification"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_chatId_messageRhid_key" ON "Notification"("chatId", "messageRhid");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationResponse_textResponseEcid_key" ON "NotificationResponse"("textResponseEcid");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramRhid_key" ON "User"("telegramRhid");

-- CreateIndex
CREATE UNIQUE INDEX "User_dataEcid_key" ON "User"("dataEcid");

-- AddForeignKey
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_tokenEcid_fkey" FOREIGN KEY ("tokenEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_dataEcid_fkey" FOREIGN KEY ("dataEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaturalLanguageInteraction" ADD CONSTRAINT "NaturalLanguageInteraction_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationResponse" ADD CONSTRAINT "NotificationResponse_textResponseEcid_fkey" FOREIGN KEY ("textResponseEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_messageEcid_fkey" FOREIGN KEY ("messageEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dataEcid_fkey" FOREIGN KEY ("dataEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
