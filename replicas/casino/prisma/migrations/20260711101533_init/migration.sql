-- CreateEnum
CREATE TYPE "BetStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_REJECTED', 'WAITING_DICE', 'LOST', 'PAYOUT_PENDING', 'PAYOUT_COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Bet" (
    "id" SERIAL NOT NULL,
    "invocationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "playerSubjectId" TEXT NOT NULL,
    "amountEcid" TEXT NOT NULL,
    "sides" INTEGER[],
    "selectedSideCount" INTEGER NOT NULL,
    "payoutAmountEcid" TEXT NOT NULL,
    "paymentIdempotencyKey" TEXT NOT NULL,
    "payoutIdempotencyKey" TEXT NOT NULL,
    "paymentOperationId" INTEGER,
    "notificationId" TEXT,
    "diceEmoji" TEXT,
    "diceValue" INTEGER,
    "status" "BetStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "Bet_invocationId_key" ON "Bet"("invocationId");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_workflowId_key" ON "Bet"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_amountEcid_key" ON "Bet"("amountEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_payoutAmountEcid_key" ON "Bet"("payoutAmountEcid");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_paymentIdempotencyKey_key" ON "Bet"("paymentIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Bet_payoutIdempotencyKey_key" ON "Bet"("payoutIdempotencyKey");

-- CreateIndex
CREATE INDEX "Bet_playerSubjectId_status_idx" ON "Bet"("playerSubjectId", "status");

-- CreateIndex
CREATE INDEX "Bet_createdAt_idx" ON "Bet"("createdAt");

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_amountEcid_fkey" FOREIGN KEY ("amountEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_payoutAmountEcid_fkey" FOREIGN KEY ("payoutAmountEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;
