-- The AUTO_ROUTED state means application rules may continue processing a
-- validated high-confidence suggestion. It is not a human approval.
ALTER TYPE "ClassificationReviewStatus" ADD VALUE 'AUTO_ROUTED';

CREATE TYPE "ProcessingRoute" AS ENUM (
  'KNOWN_KNOWLEDGE',
  'TECHNICAL_QUEUE',
  'HUMAN_ANSWER_QUEUE',
  'MANUAL_REVIEW',
  'NO_ACTION'
);

CREATE TYPE "ProcessingStatus" AS ENUM (
  'WAITING_FOR_REVIEW',
  'SEARCHING_KNOWLEDGE',
  'DRAFT_READY',
  'NO_KNOWLEDGE',
  'AWAITING_HUMAN_ANSWER',
  'TECHNICAL_QUEUED',
  'NO_ACTION',
  'FAILED',
  'SIMULATED_FORWARDED',
  'SIMULATED_SENT'
);

CREATE TYPE "DraftStatus" AS ENUM ('GENERATED', 'SUPERSEDED', 'SIMULATED_SENT');
CREATE TYPE "DraftMode" AS ENUM ('MOCK_GROUNDED', 'MANUAL');

ALTER TABLE "Classification"
  ADD COLUMN "route" "ProcessingRoute",
  ADD COLUMN "processingStatus" "ProcessingStatus",
  ADD COLUMN "routingReason" TEXT,
  ADD COLUMN "knowledgeQuery" TEXT,
  ADD COLUMN "knowledgeMatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "simulatedForwardedAt" TIMESTAMP(3);

CREATE TABLE "Draft" (
  "id" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "classificationId" UUID NOT NULL,
  "aiExecutionId" UUID,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "style" TEXT NOT NULL,
  "mode" "DraftMode" NOT NULL,
  "status" "DraftStatus" NOT NULL DEFAULT 'GENERATED',
  "approvedSubject" TEXT,
  "approvedBody" TEXT,
  "approvedAt" TIMESTAMP(3),
  "simulatedSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DraftKnowledgeSource" (
  "draftId" UUID NOT NULL,
  "knowledgeEntryId" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "relevanceScore" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "DraftKnowledgeSource_pkey" PRIMARY KEY ("draftId", "knowledgeEntryId")
);

CREATE UNIQUE INDEX "Draft_aiExecutionId_key" ON "Draft"("aiExecutionId");
CREATE INDEX "Draft_threadId_createdAt_idx" ON "Draft"("threadId", "createdAt");
CREATE INDEX "Draft_classificationId_createdAt_idx" ON "Draft"("classificationId", "createdAt");
CREATE INDEX "Draft_status_idx" ON "Draft"("status");
CREATE INDEX "DraftKnowledgeSource_knowledgeEntryId_idx" ON "DraftKnowledgeSource"("knowledgeEntryId");
CREATE INDEX "Classification_route_processingStatus_idx" ON "Classification"("route", "processingStatus");

ALTER TABLE "Draft" ADD CONSTRAINT "Draft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_aiExecutionId_fkey" FOREIGN KEY ("aiExecutionId") REFERENCES "AIExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DraftKnowledgeSource" ADD CONSTRAINT "DraftKnowledgeSource_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DraftKnowledgeSource" ADD CONSTRAINT "DraftKnowledgeSource_knowledgeEntryId_fkey" FOREIGN KEY ("knowledgeEntryId") REFERENCES "KnowledgeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
