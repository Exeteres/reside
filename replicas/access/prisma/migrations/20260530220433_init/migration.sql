-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PermissionRequestSetStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Approver" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "callbackEndpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionBinding" (
    "id" BIGSERIAL NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scope" TEXT,
    "permissionSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionRestriction" (
    "id" BIGSERIAL NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionRestriction_pkey" PRIMARY KEY ("id")
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
    "permissionRequestSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionSet" (
    "id" SERIAL NOT NULL,
    "subjectId" TEXT NOT NULL,
    "managedBySubjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionSetItem" (
    "id" BIGSERIAL NOT NULL,
    "permissionSetId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scoped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Realm" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subjectServiceEndpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Realm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionRequestSet" (
    "id" SERIAL NOT NULL,
    "subjectId" TEXT NOT NULL,
    "requestedBySubjectId" TEXT NOT NULL,
    "resolvedBySubjectId" TEXT,
    "permissionSetId" INTEGER NOT NULL,
    "permissionSetName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "status" "PermissionRequestSetStatus" NOT NULL DEFAULT 'PENDING',
    "supersededByRequestSetId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PermissionRequestSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionRequestSetItem" (
    "id" BIGSERIAL NOT NULL,
    "requestSetId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "scope" TEXT,

    CONSTRAINT "PermissionRequestSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ApproverToRealm" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ApproverToRealm_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Approver_name_key" ON "Approver"("name");

-- CreateIndex
CREATE INDEX "PermissionBinding_subjectId_scope_idx" ON "PermissionBinding"("subjectId", "scope");

-- CreateIndex
CREATE INDEX "PermissionBinding_permissionSetId_idx" ON "PermissionBinding"("permissionSetId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionBinding_permissionId_subjectId_scope_key" ON "PermissionBinding"("permissionId", "subjectId", "scope");

-- CreateIndex
CREATE INDEX "PermissionRestriction_subjectId_scope_idx" ON "PermissionRestriction"("subjectId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionRestriction_permissionId_subjectId_scope_key" ON "PermissionRestriction"("permissionId", "subjectId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_permissionRequestSetId_key" ON "Operation"("permissionRequestSetId");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE INDEX "PermissionSet_subjectId_managedBySubjectId_idx" ON "PermissionSet"("subjectId", "managedBySubjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionSet_subjectId_managedBySubjectId_name_key" ON "PermissionSet"("subjectId", "managedBySubjectId", "name");

-- CreateIndex
CREATE INDEX "PermissionSetItem_permissionSetId_idx" ON "PermissionSetItem"("permissionSetId");

-- CreateIndex
CREATE INDEX "PermissionSetItem_permissionId_idx" ON "PermissionSetItem"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionSetItem_permissionSetId_permissionId_scope_key" ON "PermissionSetItem"("permissionSetId", "permissionId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Realm_name_key" ON "Realm"("name");

-- CreateIndex
CREATE INDEX "PermissionRequestSet_permissionSetId_status_idx" ON "PermissionRequestSet"("permissionSetId", "status");

-- CreateIndex
CREATE INDEX "PermissionRequestSet_subjectId_status_idx" ON "PermissionRequestSet"("subjectId", "status");

-- CreateIndex
CREATE INDEX "PermissionRequestSet_requestedBySubjectId_status_idx" ON "PermissionRequestSet"("requestedBySubjectId", "status");

-- CreateIndex
CREATE INDEX "PermissionRequestSet_status_createdAt_idx" ON "PermissionRequestSet"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PermissionRequestSet_supersededByRequestSetId_idx" ON "PermissionRequestSet"("supersededByRequestSetId");

-- CreateIndex
CREATE INDEX "PermissionRequestSetItem_permissionId_idx" ON "PermissionRequestSetItem"("permissionId");

-- CreateIndex
CREATE INDEX "PermissionRequestSetItem_requestSetId_idx" ON "PermissionRequestSetItem"("requestSetId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionRequestSetItem_requestSetId_permissionId_scope_key" ON "PermissionRequestSetItem"("requestSetId", "permissionId", "scope");

-- CreateIndex
CREATE INDEX "_ApproverToRealm_B_index" ON "_ApproverToRealm"("B");

-- AddForeignKey
ALTER TABLE "PermissionBinding" ADD CONSTRAINT "PermissionBinding_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionBinding" ADD CONSTRAINT "PermissionBinding_permissionSetId_fkey" FOREIGN KEY ("permissionSetId") REFERENCES "PermissionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRestriction" ADD CONSTRAINT "PermissionRestriction_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Operation" ADD CONSTRAINT "Operation_permissionRequestSetId_fkey" FOREIGN KEY ("permissionRequestSetId") REFERENCES "PermissionRequestSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionSetItem" ADD CONSTRAINT "PermissionSetItem_permissionSetId_fkey" FOREIGN KEY ("permissionSetId") REFERENCES "PermissionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionSetItem" ADD CONSTRAINT "PermissionSetItem_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequestSet" ADD CONSTRAINT "PermissionRequestSet_permissionSetId_fkey" FOREIGN KEY ("permissionSetId") REFERENCES "PermissionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequestSet" ADD CONSTRAINT "PermissionRequestSet_supersededByRequestSetId_fkey" FOREIGN KEY ("supersededByRequestSetId") REFERENCES "PermissionRequestSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequestSetItem" ADD CONSTRAINT "PermissionRequestSetItem_requestSetId_fkey" FOREIGN KEY ("requestSetId") REFERENCES "PermissionRequestSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionRequestSetItem" ADD CONSTRAINT "PermissionRequestSetItem_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ApproverToRealm" ADD CONSTRAINT "_ApproverToRealm_A_fkey" FOREIGN KEY ("A") REFERENCES "Approver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ApproverToRealm" ADD CONSTRAINT "_ApproverToRealm_B_fkey" FOREIGN KEY ("B") REFERENCES "Realm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
