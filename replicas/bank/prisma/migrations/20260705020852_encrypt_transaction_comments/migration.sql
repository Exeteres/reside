/*
  Warnings:

  - You are about to drop the column `comment` on the `Transaction` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[commentEcid]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "comment",
ADD COLUMN     "commentEcid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_commentEcid_key" ON "Transaction"("commentEcid");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_commentEcid_fkey" FOREIGN KEY ("commentEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
