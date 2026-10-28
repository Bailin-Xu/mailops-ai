CREATE TYPE "KnowledgeRevisionOrigin" AS ENUM ('HUMAN_APPROVAL', 'LEGACY_BASELINE', 'SYNTHETIC_FIXTURE');
CREATE TYPE "DraftEvidenceStatus" AS ENUM ('LEGACY_UNVERIFIED', 'CAPTURED', 'HUMAN_AUTHORED');

ALTER TABLE "KnowledgeEntry" ADD COLUMN "revisionSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currentRevisionId" UUID;

CREATE TABLE "KnowledgeRevision" (
  "id" UUID NOT NULL,
  "knowledgeEntryId" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "title" TEXT NOT NULL,
  "canonicalQuestion" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "origin" "KnowledgeRevisionOrigin" NOT NULL,
  "reviewEventId" UUID,
  CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeRevision_knowledgeEntryId_fkey" FOREIGN KEY ("knowledgeEntryId") REFERENCES "KnowledgeEntry"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "KnowledgeRevision_reviewEventId_fkey" FOREIGN KEY ("reviewEventId") REFERENCES "KnowledgeCandidateReviewEvent"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "KnowledgeRevision_knowledgeEntryId_version_key" ON "KnowledgeRevision"("knowledgeEntryId", "version");
CREATE UNIQUE INDEX "KnowledgeRevision_knowledgeEntryId_id_key" ON "KnowledgeRevision"("knowledgeEntryId", "id");
CREATE UNIQUE INDEX "KnowledgeRevision_reviewEventId_key" ON "KnowledgeRevision"("reviewEventId");
CREATE UNIQUE INDEX "KnowledgeEntry_currentRevisionId_key" ON "KnowledgeEntry"("currentRevisionId");
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_currentRevisionId_fkey"
  FOREIGN KEY ("currentRevisionId") REFERENCES "KnowledgeRevision"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A current baseline is known; historical generation provenance is not.
-- Reusing the entry UUID in this separate table avoids requiring a UUID extension.
INSERT INTO "KnowledgeRevision" ("id", "knowledgeEntryId", "version", "title", "canonicalQuestion", "answer", "category", "language", "approvedAt", "origin")
SELECT "id", "id", 1, "title", "canonicalQuestion", "answer", "category", "language", "approvedAt", 'LEGACY_BASELINE'
FROM "KnowledgeEntry";
UPDATE "KnowledgeEntry" SET "currentRevisionId" = "id", "revisionSequence" = 1;

ALTER TABLE "Draft" ADD COLUMN "evidenceStatus" "DraftEvidenceStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
  ADD COLUMN "inputSnapshot" JSONB,
  ADD COLUMN "knowledgeReviewRequiredAt" TIMESTAMP(3),
  ADD COLUMN "knowledgeReviewReason" TEXT,
  ADD CONSTRAINT "Draft_captured_input_check" CHECK ("evidenceStatus" <> 'CAPTURED' OR "inputSnapshot" IS NOT NULL);
CREATE INDEX "Draft_status_knowledgeReviewRequiredAt_idx" ON "Draft"("status", "knowledgeReviewRequiredAt");
UPDATE "Draft" SET "knowledgeReviewRequiredAt" = CURRENT_TIMESTAMP,
  "knowledgeReviewReason" = 'LEGACY_EVIDENCE_UNVERIFIED' WHERE "status" = 'GENERATED';

ALTER TABLE "DraftKnowledgeSource" ADD COLUMN "knowledgeRevisionId" UUID;
ALTER TABLE "DraftKnowledgeSource" ADD CONSTRAINT "DraftKnowledgeSource_knowledgeEntryId_knowledgeRevisionId_fkey"
  FOREIGN KEY ("knowledgeEntryId", "knowledgeRevisionId") REFERENCES "KnowledgeRevision"("knowledgeEntryId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "DraftKnowledgeSource_knowledgeRevisionId_idx" ON "DraftKnowledgeSource"("knowledgeRevisionId");

CREATE FUNCTION "protect_knowledge_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Parent deletion is used only by isolated fixture cleanup; referenced entries
  -- remain protected by draft-source foreign keys. Standalone deletion is forbidden.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "KnowledgeEntry" WHERE "id" = OLD."knowledgeEntryId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Knowledge revisions are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "KnowledgeRevision_immutable" BEFORE UPDATE OR DELETE ON "KnowledgeRevision"
  FOR EACH ROW EXECUTE FUNCTION "protect_knowledge_revision"();

CREATE FUNCTION "check_current_knowledge_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "KnowledgeRevision" WHERE "id" = NEW."currentRevisionId" AND "knowledgeEntryId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Current knowledge revision belongs to another entry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "KnowledgeEntry_current_revision_owner" BEFORE INSERT OR UPDATE ON "KnowledgeEntry"
  FOR EACH ROW EXECUTE FUNCTION "check_current_knowledge_revision"();

CREATE FUNCTION "protect_draft_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."inputSnapshot" IS DISTINCT FROM OLD."inputSnapshot" OR NEW."evidenceStatus" <> OLD."evidenceStatus" THEN
    RAISE EXCEPTION 'Draft input evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Draft_input_evidence_immutable" BEFORE UPDATE ON "Draft"
  FOR EACH ROW EXECUTE FUNCTION "protect_draft_evidence"();

CREATE FUNCTION "protect_draft_source"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Draft source evidence is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DraftKnowledgeSource_immutable" BEFORE UPDATE ON "DraftKnowledgeSource"
  FOR EACH ROW EXECUTE FUNCTION "protect_draft_source"();
