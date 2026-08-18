-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('UNASSESSED', 'READY_FOR_REVIEW', 'EXCLUDED');

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "knowledgeExclusionReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "knowledgeSourceStatus" "KnowledgeSourceStatus" NOT NULL DEFAULT 'UNASSESSED';

-- CreateIndex
CREATE INDEX "EmailMessage_knowledgeSourceStatus_idx" ON "EmailMessage"("knowledgeSourceStatus");
