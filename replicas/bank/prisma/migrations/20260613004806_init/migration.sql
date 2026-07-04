-- CreateTable
CREATE TABLE "EncryptedContent" (
    "ecid" TEXT NOT NULL,
    "data" TEXT NOT NULL,

    CONSTRAINT "EncryptedContent_pkey" PRIMARY KEY ("ecid")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "subjectRhid" TEXT NOT NULL,
    "balanceEcid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "recipientAccountId" TEXT NOT NULL,
    "amountEcid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_subjectRhid_key" ON "Account"("subjectRhid");

-- CreateIndex
CREATE UNIQUE INDEX "Account_balanceEcid_key" ON "Account"("balanceEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_amountEcid_key" ON "Transaction"("amountEcid");

-- CreateIndex
CREATE INDEX "Transaction_senderAccountId_createdAt_idx" ON "Transaction"("senderAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_recipientAccountId_createdAt_idx" ON "Transaction"("recipientAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_balanceEcid_fkey" FOREIGN KEY ("balanceEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recipientAccountId_fkey" FOREIGN KEY ("recipientAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amountEcid_fkey" FOREIGN KEY ("amountEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
