/*
  Warnings:

  - You are about to drop the column `subjectId` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the `TaskPrompt` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `createdBy` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phase` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PLANNING', 'PLAN_READY', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'REQUESTED_CANCELLATION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPhase" AS ENUM ('PLANNING', 'IMPLEMENTATION');

-- DropForeignKey
ALTER TABLE "TaskPrompt" DROP CONSTRAINT "TaskPrompt_taskId_fkey";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "subjectId",
ADD COLUMN     "createdBy" TEXT NOT NULL,
ADD COLUMN     "phase" "TaskPhase" NOT NULL,
ADD COLUMN     "status" "TaskStatus" NOT NULL,
ADD COLUMN     "updatedBy" TEXT;

-- DropTable
DROP TABLE "TaskPrompt";

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
CREATE INDEX "TaskIteration_taskId_iteration_idx" ON "TaskIteration"("taskId", "iteration");

-- AddForeignKey
ALTER TABLE "TaskIteration" ADD CONSTRAINT "TaskIteration_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
