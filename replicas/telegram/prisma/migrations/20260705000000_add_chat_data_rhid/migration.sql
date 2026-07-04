-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "dataRhid" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Chat_dataRhid_key" ON "Chat"("dataRhid");
