-- CreateEnum
CREATE TYPE "WebsiteKnowledgeReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'NEEDS_FOLLOW_UP', 'REJECTED');

-- CreateTable
CREATE TABLE "WebsiteSource" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteKnowledgeReviewItem" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questionForOwner" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "status" "WebsiteKnowledgeReviewStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAnswer" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteKnowledgeReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteKnowledgeEvidence" (
    "id" UUID NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "reviewItemId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "sectionHeading" TEXT,
    "claim" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteKnowledgeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteKnowledgeReviewEvent" (
    "id" UUID NOT NULL,
    "reviewItemId" UUID NOT NULL,
    "decision" "WebsiteKnowledgeReviewStatus" NOT NULL,
    "confirmedAnswer" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteKnowledgeReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteSource_url_key" ON "WebsiteSource"("url");

-- CreateIndex
CREATE INDEX "WebsiteSource_language_idx" ON "WebsiteSource"("language");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteKnowledgeReviewItem_key_key" ON "WebsiteKnowledgeReviewItem"("key");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeReviewItem_status_idx" ON "WebsiteKnowledgeReviewItem"("status");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeReviewItem_language_idx" ON "WebsiteKnowledgeReviewItem"("language");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteKnowledgeEvidence_evidenceKey_key" ON "WebsiteKnowledgeEvidence"("evidenceKey");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeEvidence_reviewItemId_idx" ON "WebsiteKnowledgeEvidence"("reviewItemId");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeEvidence_sourceId_idx" ON "WebsiteKnowledgeEvidence"("sourceId");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeReviewEvent_reviewItemId_createdAt_idx" ON "WebsiteKnowledgeReviewEvent"("reviewItemId", "createdAt");

-- CreateIndex
CREATE INDEX "WebsiteKnowledgeReviewEvent_decision_idx" ON "WebsiteKnowledgeReviewEvent"("decision");

-- AddForeignKey
ALTER TABLE "WebsiteKnowledgeEvidence" ADD CONSTRAINT "WebsiteKnowledgeEvidence_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "WebsiteKnowledgeReviewItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteKnowledgeEvidence" ADD CONSTRAINT "WebsiteKnowledgeEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WebsiteSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteKnowledgeReviewEvent" ADD CONSTRAINT "WebsiteKnowledgeReviewEvent_reviewItemId_fkey" FOREIGN KEY ("reviewItemId") REFERENCES "WebsiteKnowledgeReviewItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
