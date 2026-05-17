-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PLANNING', 'PLAN_READY', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REQUESTED_CANCELLATION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPhase" AS ENUM ('PLANNING', 'IMPLEMENTATION');

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "phase" "TaskPhase" NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "issueId" INTEGER,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskIteration" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "iteration" INTEGER NOT NULL,
    "phase" "TaskPhase" NOT NULL,
    "prompt" TEXT NOT NULL,
    "resultSummary" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskIteration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_issueId_key" ON "Task"("issueId");

-- CreateIndex
CREATE INDEX "TaskIteration_taskId_iteration_idx" ON "TaskIteration"("taskId", "iteration");

-- AddForeignKey
ALTER TABLE "TaskIteration" ADD CONSTRAINT "TaskIteration_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
