-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('ISSUE', 'TRANSFER');

-- CreateTable
CREATE TABLE "Account" (
    "subject_id" TEXT NOT NULL,
    "balanceEcid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("subject_id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" BIGSERIAL NOT NULL,
    "kind" "TransactionKind" NOT NULL,
    "sender_subject_id" TEXT,
    "recipient_subject_id" TEXT NOT NULL,
    "amountEcid" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedContent" (
    "ecid" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "EncryptedContent_pkey" PRIMARY KEY ("ecid")
);

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
CREATE UNIQUE INDEX "Account_balanceEcid_key" ON "Account"("balanceEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_amountEcid_key" ON "Transaction"("amountEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_sender_subject_id_createdAt_idx" ON "Transaction"("sender_subject_id", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_recipient_subject_id_createdAt_idx" ON "Transaction"("recipient_subject_id", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_balanceEcid_fkey" FOREIGN KEY ("balanceEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sender_subject_id_fkey" FOREIGN KEY ("sender_subject_id") REFERENCES "Account"("subject_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recipient_subject_id_fkey" FOREIGN KEY ("recipient_subject_id") REFERENCES "Account"("subject_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amountEcid_fkey" FOREIGN KEY ("amountEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
