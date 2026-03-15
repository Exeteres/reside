ALTER TABLE "Task"
DROP COLUMN "initialPrompt",
DROP COLUMN "latestPrompt";

CREATE TABLE "TaskPrompt" (
  "id" SERIAL NOT NULL,
  "taskId" INTEGER NOT NULL,
  "prompt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskPrompt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskPrompt_taskId_createdAt_idx" ON "TaskPrompt"("taskId", "createdAt");

ALTER TABLE "TaskPrompt"
ADD CONSTRAINT "TaskPrompt_taskId_fkey"
FOREIGN KEY ("taskId")
REFERENCES "Task"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
