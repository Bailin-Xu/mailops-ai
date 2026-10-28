ALTER TYPE "DraftStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ProcessingStatus" ADD VALUE 'DRAFT_REJECTED';
ALTER TABLE "Draft"
  ADD COLUMN "reviewRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "editedSubject" TEXT,
  ADD COLUMN "editedBody" TEXT,
  ADD COLUMN "editedLanguage" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;
