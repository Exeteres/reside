/*
  Warnings:

  - A unique constraint covering the columns `[commentEcid]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "commentEcid" TEXT;

-- CreateTable
CREATE TABLE "MemoryNote" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_commentEcid_key" ON "Transaction"("commentEcid");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_commentEcid_fkey" FOREIGN KEY ("commentEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
