CREATE TABLE "Task" (
  "id" SERIAL NOT NULL,
  "subjectId" TEXT NOT NULL,
  "issueId" INTEGER NOT NULL,
  "initialPrompt" TEXT NOT NULL,
  "latestPrompt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Task_issueId_key" ON "Task"("issueId");
