-- DropIndex
DROP INDEX "NaturalLanguageInteraction_chatId_threadRhid_key";

-- AlterTable
ALTER TABLE "NaturalLanguageInteraction" DROP COLUMN "threadRhid";

-- CreateIndex
CREATE UNIQUE INDEX "NaturalLanguageInteraction_chatId_userId_replicaName_key" ON "NaturalLanguageInteraction"("chatId", "userId", "replicaName");
