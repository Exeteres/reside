-- AlterEnum
ALTER TYPE "NotificationResponseType" ADD VALUE 'DICE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "acceptedDiceEmojis" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "NotificationResponse" ADD COLUMN     "diceEmoji" TEXT,
ADD COLUMN     "diceValue" INTEGER;
