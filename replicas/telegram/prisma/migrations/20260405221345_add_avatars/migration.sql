-- CreateTable
CREATE TABLE "Avatar" (
    "id" SERIAL NOT NULL,
    "subjectId" TEXT NOT NULL,
    "replicaName" TEXT NOT NULL,
    "replicaTitle" TEXT NOT NULL,
    "managedBotId" TEXT NOT NULL,
    "managedBotUsername" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvatarProvisionRequest" (
    "id" SERIAL NOT NULL,
    "operationId" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "replicaName" TEXT NOT NULL,
    "replicaTitle" TEXT NOT NULL,
    "expectedPrefix" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "notificationId" INTEGER,
    "avatarId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvatarProvisionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnauthorizedAvatar" (
    "id" SERIAL NOT NULL,
    "managedBotId" TEXT,
    "managedBotUsername" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnauthorizedAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_subjectId_key" ON "Avatar"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_replicaName_key" ON "Avatar"("replicaName");

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_managedBotId_key" ON "Avatar"("managedBotId");

-- CreateIndex
CREATE UNIQUE INDEX "Avatar_managedBotUsername_key" ON "Avatar"("managedBotUsername");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarProvisionRequest_operationId_key" ON "AvatarProvisionRequest"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "AvatarProvisionRequest_notificationId_key" ON "AvatarProvisionRequest"("notificationId");

-- CreateIndex
CREATE INDEX "AvatarProvisionRequest_expectedPrefix_idx" ON "AvatarProvisionRequest"("expectedPrefix");

-- CreateIndex
CREATE INDEX "AvatarProvisionRequest_subjectId_idx" ON "AvatarProvisionRequest"("subjectId");

-- CreateIndex
CREATE INDEX "AvatarProvisionRequest_avatarId_idx" ON "AvatarProvisionRequest"("avatarId");

-- CreateIndex
CREATE INDEX "UnauthorizedAvatar_managedBotUsername_idx" ON "UnauthorizedAvatar"("managedBotUsername");

-- CreateIndex
CREATE INDEX "UnauthorizedAvatar_reason_idx" ON "UnauthorizedAvatar"("reason");

-- AddForeignKey
ALTER TABLE "Avatar" ADD CONSTRAINT "Avatar_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarProvisionRequest" ADD CONSTRAINT "AvatarProvisionRequest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarProvisionRequest" ADD CONSTRAINT "AvatarProvisionRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarProvisionRequest" ADD CONSTRAINT "AvatarProvisionRequest_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvatarProvisionRequest" ADD CONSTRAINT "AvatarProvisionRequest_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnauthorizedAvatar" ADD CONSTRAINT "UnauthorizedAvatar_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
