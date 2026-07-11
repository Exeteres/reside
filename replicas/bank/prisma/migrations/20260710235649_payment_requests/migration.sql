-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'APPROVED_ALWAYS', 'REJECTED');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('PAYMENT_REQUEST');

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" SERIAL NOT NULL,
    "operationId" INTEGER NOT NULL,
    "payerSubjectId" TEXT NOT NULL,
    "requesterSubjectId" TEXT NOT NULL,
    "amountEcid" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "commentEcid" TEXT,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "transactionId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAuthorization" (
    "id" SERIAL NOT NULL,
    "payerSubjectId" TEXT NOT NULL,
    "requesterSubjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "failureMessage" TEXT,
    "callbackEndpoint" TEXT,
    "customData" JSONB,
    "type" "OperationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_operationId_key" ON "PaymentRequest"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_amountEcid_key" ON "PaymentRequest"("amountEcid");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_idempotencyKey_key" ON "PaymentRequest"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_commentEcid_key" ON "PaymentRequest"("commentEcid");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_transactionId_key" ON "PaymentRequest"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentRequest_payerSubjectId_status_idx" ON "PaymentRequest"("payerSubjectId", "status");

-- CreateIndex
CREATE INDEX "PaymentRequest_requesterSubjectId_status_idx" ON "PaymentRequest"("requesterSubjectId", "status");

-- CreateIndex
CREATE INDEX "PaymentAuthorization_requesterSubjectId_idx" ON "PaymentAuthorization"("requesterSubjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAuthorization_payerSubjectId_requesterSubjectId_key" ON "PaymentAuthorization"("payerSubjectId", "requesterSubjectId");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE INDEX "Operation_type_status_idx" ON "Operation"("type", "status");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_amountEcid_fkey" FOREIGN KEY ("amountEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_commentEcid_fkey" FOREIGN KEY ("commentEcid") REFERENCES "EncryptedContent"("ecid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
