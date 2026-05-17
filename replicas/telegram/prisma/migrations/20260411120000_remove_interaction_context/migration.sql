-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "targetChatId" TEXT,
  ADD COLUMN "replyToMessageId" INTEGER;

-- Backfill new notification target fields from legacy interaction contexts.
UPDATE "Notification" AS "n"
SET
  "targetChatId" = COALESCE("c"."telegramId", "u"."telegramId"),
  "replyToMessageId" = CASE
    WHEN "ic"."type" = 'USER_IN_CHAT' THEN "ic"."lastUserMessageId"
    ELSE NULL
  END
FROM "InteractionContext" AS "ic"
LEFT JOIN "Chat" AS "c" ON "c"."id" = "ic"."chatId"
LEFT JOIN "User" AS "u" ON "u"."id" = "ic"."userId"
WHERE "n"."contextId" = "ic"."id";

-- Fallback for legacy system contexts that do not map to chat/user rows.
UPDATE "Notification"
SET "targetChatId" = '0'
WHERE "targetChatId" IS NULL;

-- Make the new target chat field mandatory.
ALTER TABLE "Notification"
  ALTER COLUMN "targetChatId" SET NOT NULL;

-- Ensure each target chat id has a corresponding Chat row.
INSERT INTO "Chat" ("telegramId", "data", "updatedAt")
SELECT DISTINCT "n"."targetChatId", '{}'::jsonb, NOW()
FROM "Notification" AS "n"
LEFT JOIN "Chat" AS "c" ON "c"."telegramId" = "n"."targetChatId"
WHERE "c"."id" IS NULL;

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_contextId_fkey";

-- DropIndex
DROP INDEX "Notification_contextId_idx";

-- DropIndex
DROP INDEX "InteractionContext_chatId_idx";

-- DropIndex
DROP INDEX "InteractionContext_userId_idx";

-- DropIndex
DROP INDEX "InteractionContext_type_chatId_userId_key";

-- CreateIndex
CREATE INDEX "Notification_targetChatId_idx" ON "Notification"("targetChatId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_targetChatId_fkey" FOREIGN KEY ("targetChatId") REFERENCES "Chat"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "contextId";

-- DropTable
DROP TABLE "InteractionContext";

-- DropEnum
DROP TYPE "InteractionContextType";
