ALTER TABLE "EmailThread"
  ADD COLUMN "mergedIntoThreadId" UUID,
  ADD COLUMN "mergedAt" TIMESTAMP(3),
  ADD COLUMN "reconstructedAt" TIMESTAMP(3);
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_mergedIntoThreadId_fkey"
  FOREIGN KEY ("mergedIntoThreadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_no_self_merge"
  CHECK ("mergedIntoThreadId" IS NULL OR "mergedIntoThreadId" <> "id");
CREATE INDEX "EmailThread_mergedIntoThreadId_idx" ON "EmailThread"("mergedIntoThreadId");
