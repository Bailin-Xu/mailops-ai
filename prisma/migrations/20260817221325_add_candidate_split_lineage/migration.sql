-- AlterTable
ALTER TABLE "KnowledgeCandidate" ADD COLUMN     "parentCandidateId" UUID;

-- CreateIndex
CREATE INDEX "KnowledgeCandidate_parentCandidateId_idx" ON "KnowledgeCandidate"("parentCandidateId");

-- AddForeignKey
ALTER TABLE "KnowledgeCandidate" ADD CONSTRAINT "KnowledgeCandidate_parentCandidateId_fkey" FOREIGN KEY ("parentCandidateId") REFERENCES "KnowledgeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
