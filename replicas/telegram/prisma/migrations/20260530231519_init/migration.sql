-- CreateEnum
CREATE TYPE "ApprovalResult" AS ENUM ('ESCALATED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationResponseType" AS ENUM ('ACTION', 'TEXT');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" SERIAL NOT NULL,
    "operationId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "result" "ApprovalResult",
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Command" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "parameters" JSONB NOT NULL,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "callbackEndpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaturalLanguageInteraction" (
    "id" SERIAL NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "replicaName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaturalLanguageInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationResponse" (
    "operationId" INTEGER NOT NULL,
    "type" "NotificationResponseType" NOT NULL,
    "actionName" TEXT,
    "textResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationResponse_pkey" PRIMARY KEY ("operationId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "operationId" INTEGER,
    "targetChatId" TEXT NOT NULL,
    "replyToMessageId" INTEGER,
    "channelId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "callingSubjectId" TEXT,
    "sendAsSubjectId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actionRows" JSONB NOT NULL,
    "requiresTextResponse" BOOLEAN NOT NULL DEFAULT false,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "expectImmediateFeedback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "telegramId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_operationId_key" ON "ApprovalRequest"("operationId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_createdAt_idx" ON "ApprovalRequest"("createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_name_key" ON "NotificationChannel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Chat_telegramId_key" ON "Chat"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Command_name_key" ON "Command"("name");

-- CreateIndex
CREATE INDEX "NaturalLanguageInteraction_chatId_userId_idx" ON "NaturalLanguageInteraction"("chatId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NaturalLanguageInteraction_chatId_threadId_key" ON "NaturalLanguageInteraction"("chatId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_operationId_key" ON "Notification"("operationId");

-- CreateIndex
CREATE INDEX "Notification_messageId_idx" ON "Notification"("messageId");

-- CreateIndex
CREATE INDEX "Notification_channelId_idx" ON "Notification"("channelId");

-- CreateIndex
CREATE INDEX "Notification_targetChatId_idx" ON "Notification"("targetChatId");

-- CreateIndex
CREATE INDEX "Operation_createdAt_idx" ON "Operation"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "NaturalLanguageInteraction" ADD CONSTRAINT "NaturalLanguageInteraction_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaturalLanguageInteraction" ADD CONSTRAINT "NaturalLanguageInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationResponse" ADD CONSTRAINT "NotificationResponse_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_targetChatId_fkey" FOREIGN KEY ("targetChatId") REFERENCES "Chat"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
