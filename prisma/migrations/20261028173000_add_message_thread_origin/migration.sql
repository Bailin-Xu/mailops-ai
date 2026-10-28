ALTER TABLE "EmailMessage" ADD COLUMN "originalThreadId" UUID;
UPDATE "EmailMessage" SET "originalThreadId" = "threadId";
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_originalThreadId_fkey"
  FOREIGN KEY ("originalThreadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "EmailMessage_originalThreadId_idx" ON "EmailMessage"("originalThreadId");
