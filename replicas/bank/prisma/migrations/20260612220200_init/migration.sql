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

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "subjectRhid" TEXT NOT NULL,
    "subjectEcid" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "senderId" INTEGER NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "recipientLabelEcid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_subjectRhid_key" ON "Account"("subjectRhid");

-- CreateIndex
CREATE UNIQUE INDEX "Account_subjectEcid_key" ON "Account"("subjectEcid");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_recipientLabelEcid_key" ON "LedgerEntry"("recipientLabelEcid");

-- CreateIndex
CREATE INDEX "LedgerEntry_senderId_createdAt_idx" ON "LedgerEntry"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_recipientId_createdAt_idx" ON "LedgerEntry"("recipientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_subjectEcid_fkey" FOREIGN KEY ("subjectEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_recipientLabelEcid_fkey" FOREIGN KEY ("recipientLabelEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
