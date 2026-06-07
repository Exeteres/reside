/*
  Warnings:

  - You are about to drop the column `dataEcid` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[telegramUserIdEcid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[usernameEcid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[firstNameEcid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lastNameEcid]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `telegramUserIdEcid` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_dataEcid_fkey";

-- DropIndex
DROP INDEX "User_dataEcid_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "dataEcid",
ADD COLUMN     "firstNameEcid" TEXT,
ADD COLUMN     "lastNameEcid" TEXT,
ADD COLUMN     "telegramUserIdEcid" TEXT NOT NULL,
ADD COLUMN     "usernameEcid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserIdEcid_key" ON "User"("telegramUserIdEcid");

-- CreateIndex
CREATE UNIQUE INDEX "User_usernameEcid_key" ON "User"("usernameEcid");

-- CreateIndex
CREATE UNIQUE INDEX "User_firstNameEcid_key" ON "User"("firstNameEcid");

-- CreateIndex
CREATE UNIQUE INDEX "User_lastNameEcid_key" ON "User"("lastNameEcid");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_telegramUserIdEcid_fkey" FOREIGN KEY ("telegramUserIdEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_usernameEcid_fkey" FOREIGN KEY ("usernameEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_firstNameEcid_fkey" FOREIGN KEY ("firstNameEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lastNameEcid_fkey" FOREIGN KEY ("lastNameEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE SET NULL ON UPDATE CASCADE;
