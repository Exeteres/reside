-- AlterTable
ALTER TABLE "User" ADD COLUMN     "rewardedMessages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalMessages" INTEGER NOT NULL DEFAULT 0;
