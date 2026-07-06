/*
  Warnings:

  - The values [APPROVAL_REQUEST] on the enum `OperationType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `ApprovalRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_operationId_fkey";

-- Drop obsolete approval operations before removing the enum value.
DELETE FROM "Operation"
WHERE "id" IN (SELECT "operationId" FROM "ApprovalRequest");

-- DropTable
DROP TABLE "ApprovalRequest";

-- AlterEnum
BEGIN;
CREATE TYPE "OperationType_new" AS ENUM ('NOTIFICATION_RESPONSE', 'AVATAR_PROVISION', 'DELETE_AVATAR');
ALTER TABLE "Operation" ALTER COLUMN "type" TYPE "OperationType_new" USING ("type"::text::"OperationType_new");
ALTER TYPE "OperationType" RENAME TO "OperationType_old";
ALTER TYPE "OperationType_new" RENAME TO "OperationType";
DROP TYPE "public"."OperationType_old";
COMMIT;

-- AlterTable
ALTER TABLE "NotificationResponse" ADD COLUMN     "subjectId" TEXT;

-- DropEnum
DROP TYPE "ApprovalResult";
