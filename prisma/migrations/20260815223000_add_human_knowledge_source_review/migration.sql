-- CreateEnum
CREATE TYPE "KnowledgeReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'NEEDS_FOLLOW_UP', 'REJECTED');

-- AlterTable
ALTER TABLE "EmailMessage"
ADD COLUMN "knowledgeReviewStatus" "KnowledgeReviewStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "knowledgeReviewNote" TEXT,
ADD COLUMN "knowledgeReviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnowledgeSourceReviewEvent" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "decision" "KnowledgeReviewStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSourceReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailMessage_knowledgeReviewStatus_idx" ON "EmailMessage"("knowledgeReviewStatus");

-- CreateIndex
CREATE INDEX "KnowledgeSourceReviewEvent_messageId_createdAt_idx" ON "KnowledgeSourceReviewEvent"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeSourceReviewEvent_decision_idx" ON "KnowledgeSourceReviewEvent"("decision");

-- AddForeignKey
ALTER TABLE "KnowledgeSourceReviewEvent" ADD CONSTRAINT "KnowledgeSourceReviewEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
