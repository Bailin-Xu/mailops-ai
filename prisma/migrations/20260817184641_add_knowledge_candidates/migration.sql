-- CreateEnum
CREATE TYPE "KnowledgeCandidateStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KnowledgeCandidateSourceType" AS ENUM ('EMAIL', 'WEBSITE');

-- CreateEnum
CREATE TYPE "KnowledgeEntryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "KnowledgeCandidate" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "canonicalQuestion" TEXT NOT NULL,
    "proposedAnswer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "KnowledgeCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedTitle" TEXT,
    "reviewedQuestion" TEXT,
    "reviewedAnswer" TEXT,
    "reviewedCategory" TEXT,
    "reviewedLanguage" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCandidateSource" (
    "id" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "candidateId" UUID NOT NULL,
    "sourceType" "KnowledgeCandidateSourceType" NOT NULL,
    "emailMessageId" UUID,
    "websiteSourceId" UUID,
    "sourceLabel" TEXT NOT NULL,
    "sourceExcerpt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCandidateSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCandidateReviewEvent" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "decision" "KnowledgeCandidateStatus" NOT NULL,
    "reviewedTitle" TEXT,
    "reviewedQuestion" TEXT,
    "reviewedAnswer" TEXT,
    "reviewedCategory" TEXT,
    "reviewedLanguage" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCandidateReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
    "id" UUID NOT NULL,
    "sourceCandidateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "canonicalQuestion" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "KnowledgeEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCandidate_fingerprint_key" ON "KnowledgeCandidate"("fingerprint");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_status_idx" ON "KnowledgeCandidate"("status");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_category_idx" ON "KnowledgeCandidate"("category");

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_language_idx" ON "KnowledgeCandidate"("language");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCandidateSource_sourceKey_key" ON "KnowledgeCandidateSource"("sourceKey");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateSource_candidateId_idx" ON "KnowledgeCandidateSource"("candidateId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateSource_sourceType_idx" ON "KnowledgeCandidateSource"("sourceType");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateSource_emailMessageId_idx" ON "KnowledgeCandidateSource"("emailMessageId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateSource_websiteSourceId_idx" ON "KnowledgeCandidateSource"("websiteSourceId");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateReviewEvent_candidateId_createdAt_idx" ON "KnowledgeCandidateReviewEvent"("candidateId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeCandidateReviewEvent_decision_idx" ON "KnowledgeCandidateReviewEvent"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntry_sourceCandidateId_key" ON "KnowledgeEntry"("sourceCandidateId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_status_idx" ON "KnowledgeEntry"("status");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_category_idx" ON "KnowledgeEntry"("category");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_language_idx" ON "KnowledgeEntry"("language");

-- AddForeignKey
ALTER TABLE "KnowledgeCandidateSource" ADD CONSTRAINT "KnowledgeCandidateSource_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "KnowledgeCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCandidateSource" ADD CONSTRAINT "KnowledgeCandidateSource_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCandidateSource" ADD CONSTRAINT "KnowledgeCandidateSource_websiteSourceId_fkey" FOREIGN KEY ("websiteSourceId") REFERENCES "WebsiteSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCandidateReviewEvent" ADD CONSTRAINT "KnowledgeCandidateReviewEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "KnowledgeCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "KnowledgeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
