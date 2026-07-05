-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_firstNameEcid_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_lastNameEcid_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_telegramUserIdEcid_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_usernameEcid_fkey";

-- DropIndex
DROP INDEX "User_firstNameEcid_key";

-- DropIndex
DROP INDEX "User_lastNameEcid_key";

-- DropIndex
DROP INDEX "User_telegramUserIdEcid_key";

-- DropIndex
DROP INDEX "User_usernameEcid_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "firstNameEcid",
DROP COLUMN "lastNameEcid",
DROP COLUMN "telegramUserIdEcid",
DROP COLUMN "usernameEcid",
ADD COLUMN     "dataEcid" TEXT,
ADD COLUMN     "dataRhid" TEXT,
ADD COLUMN     "usernameRhid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameRhid_key" ON "User"("usernameRhid");

-- CreateIndex
CREATE UNIQUE INDEX "User_dataEcid_key" ON "User"("dataEcid");

-- CreateIndex
CREATE UNIQUE INDEX "User_dataRhid_key" ON "User"("dataRhid");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_dataEcid_fkey" FOREIGN KEY ("dataEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;
