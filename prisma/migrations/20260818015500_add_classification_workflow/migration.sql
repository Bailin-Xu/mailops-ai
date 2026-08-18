-- CreateEnum
CREATE TYPE "ClassificationCategory" AS ENUM ('KNOWN_QUESTION', 'TECHNICAL_ISSUE', 'ACCOUNT_ACCESS', 'PAYMENT_ADMINISTRATIVE', 'BUSINESS_PARTNERSHIP', 'UNKNOWN_QUESTION', 'IRRELEVANT_SPAM', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "ClassificationReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "AIExecutionStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AIExecution" (
    "id" UUID NOT NULL,
    "taskType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "AIExecutionStatus" NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "inputMetadata" JSONB NOT NULL,
    "output" JSONB,
    "validationErrors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "aiExecutionId" UUID NOT NULL,
    "aiCategory" "ClassificationCategory" NOT NULL,
    "aiConfidence" DOUBLE PRECISION NOT NULL,
    "aiLanguage" TEXT NOT NULL,
    "aiSummary" TEXT NOT NULL,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewedCategory" "ClassificationCategory",
    "reviewedSummary" TEXT,
    "correctionNote" TEXT,
    "reviewStatus" "ClassificationReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIExecution_taskType_createdAt_idx" ON "AIExecution"("taskType", "createdAt");
CREATE INDEX "AIExecution_provider_status_idx" ON "AIExecution"("provider", "status");
CREATE UNIQUE INDEX "Classification_aiExecutionId_key" ON "Classification"("aiExecutionId");
CREATE INDEX "Classification_threadId_createdAt_idx" ON "Classification"("threadId", "createdAt");
CREATE INDEX "Classification_reviewStatus_idx" ON "Classification"("reviewStatus");
CREATE INDEX "Classification_aiCategory_idx" ON "Classification"("aiCategory");
CREATE INDEX "Classification_aiLanguage_idx" ON "Classification"("aiLanguage");

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_aiExecutionId_fkey" FOREIGN KEY ("aiExecutionId") REFERENCES "AIExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
