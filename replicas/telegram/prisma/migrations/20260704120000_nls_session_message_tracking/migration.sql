-- CreateEnum
CREATE TYPE "NaturalLanguageInteractionMessageSender" AS ENUM ('USER', 'AVATAR');

-- AlterTable
ALTER TABLE "NaturalLanguageInteraction" ADD COLUMN     "lastMessageLinkEcid" TEXT,
ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "NaturalLanguageInteractionMessage" (
    "id" SERIAL NOT NULL,
    "interactionId" INTEGER NOT NULL,
    "messageRhid" TEXT NOT NULL,
    "sender" "NaturalLanguageInteractionMessageSender" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NaturalLanguageInteractionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaturalLanguageInteractionMessage_interactionId_idx" ON "NaturalLanguageInteractionMessage"("interactionId");

-- CreateIndex
CREATE UNIQUE INDEX "NaturalLanguageInteractionMessage_messageRhid_key" ON "NaturalLanguageInteractionMessage"("messageRhid");

-- CreateIndex
CREATE UNIQUE INDEX "NaturalLanguageInteraction_lastMessageLinkEcid_key" ON "NaturalLanguageInteraction"("lastMessageLinkEcid");

-- CreateIndex
CREATE INDEX "NaturalLanguageInteraction_sessionId_idx" ON "NaturalLanguageInteraction"("sessionId");

-- AddForeignKey
ALTER TABLE "NaturalLanguageInteraction" ADD CONSTRAINT "NaturalLanguageInteraction_lastMessageLinkEcid_fkey" FOREIGN KEY ("lastMessageLinkEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaturalLanguageInteractionMessage" ADD CONSTRAINT "NaturalLanguageInteractionMessage_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "NaturalLanguageInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
