-- Additive validity tokens; historical context is deliberately not invented.
ALTER TABLE "EmailThread" ADD COLUMN "workflowRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailMessage" ADD COLUMN "knowledgeReviewRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Classification" ADD COLUMN "threadRevision" INTEGER,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceContextHash" TEXT;
ALTER TABLE "KnowledgeCandidate" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Draft" ADD COLUMN "classificationRevision" INTEGER;
ALTER TABLE "DraftKnowledgeSource" ADD COLUMN "knowledgeFingerprint" TEXT;
ALTER TABLE "WebsiteKnowledgeReviewItem" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
