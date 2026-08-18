CREATE TYPE "ExternalEmailProvider" AS ENUM ('EML_IMPORT', 'GMAIL');
CREATE TYPE "AutomationState" AS ENUM (
  'RECEIVED',
  'CLASSIFIED',
  'AWAITING_HUMAN',
  'REPLY_SCHEDULED',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "ReplyDispatchState" AS ENUM (
  'REPLY_SCHEDULED',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "ReplyApprovalMode" AS ENUM ('HUMAN_CONFIRMED', 'AUTO_LOW_RISK');
CREATE TYPE "ReplyDeliveryProvider" AS ENUM ('SIMULATED', 'GMAIL');
CREATE TYPE "BugSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "BugTicketStatus" AS ENUM (
  'RECEIVED',
  'QUEUED',
  'CLAIMED',
  'AWAITING_REPORTER',
  'RESOLVED',
  'FAILED',
  'CANCELLED'
);

ALTER TABLE "EmailThread"
  ADD COLUMN "automationState" "AutomationState" NOT NULL DEFAULT 'RECEIVED',
  ADD COLUMN "artistId" TEXT,
  ADD COLUMN "wordpressId" TEXT,
  ADD COLUMN "artistEmail" TEXT;

ALTER TABLE "EmailMessage"
  ADD COLUMN "sourceProvider" "ExternalEmailProvider" NOT NULL DEFAULT 'EML_IMPORT',
  ADD COLUMN "externalMessageId" TEXT,
  ADD COLUMN "externalThreadId" TEXT,
  ADD COLUMN "providerHistoryId" TEXT;

ALTER TABLE "AIExecution"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "costMicros" BIGINT;

CREATE TABLE "ReplyDispatch" (
  "id" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "provider" "ReplyDeliveryProvider" NOT NULL DEFAULT 'SIMULATED',
  "approvalMode" "ReplyApprovalMode" NOT NULL,
  "state" "ReplyDispatchState" NOT NULL DEFAULT 'REPLY_SCHEDULED',
  "delayAt" TIMESTAMP(3) NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "externalMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReplyDispatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BugTicket" (
  "id" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "classificationId" UUID NOT NULL,
  "summary" TEXT NOT NULL,
  "page" TEXT,
  "reproductionSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "severity" "BugSeverity" NOT NULL,
  "artistId" TEXT,
  "wordpressId" TEXT,
  "artistEmail" TEXT,
  "status" "BugTicketStatus" NOT NULL DEFAULT 'RECEIVED',
  "assignedDeveloperExternalId" TEXT,
  "discordMessageId" TEXT,
  "developerReply" TEXT,
  "replySubmittedAt" TIMESTAMP(3),
  "claimedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BugTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SafetyControl" (
  "id" TEXT NOT NULL,
  "shadowMode" BOOLEAN NOT NULL DEFAULT true,
  "externalDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SafetyControl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailThread_automationState_idx" ON "EmailThread"("automationState");
CREATE INDEX "EmailThread_artistId_idx" ON "EmailThread"("artistId");
CREATE INDEX "EmailThread_wordpressId_idx" ON "EmailThread"("wordpressId");
CREATE INDEX "EmailThread_artistEmail_idx" ON "EmailThread"("artistEmail");
CREATE UNIQUE INDEX "EmailMessage_sourceProvider_externalMessageId_key" ON "EmailMessage"("sourceProvider", "externalMessageId");
CREATE INDEX "EmailMessage_sourceProvider_externalThreadId_idx" ON "EmailMessage"("sourceProvider", "externalThreadId");
CREATE UNIQUE INDEX "ReplyDispatch_draftId_key" ON "ReplyDispatch"("draftId");
CREATE UNIQUE INDEX "ReplyDispatch_idempotencyKey_key" ON "ReplyDispatch"("idempotencyKey");
CREATE INDEX "ReplyDispatch_state_nextAttemptAt_idx" ON "ReplyDispatch"("state", "nextAttemptAt");
CREATE INDEX "ReplyDispatch_threadId_createdAt_idx" ON "ReplyDispatch"("threadId", "createdAt");
CREATE INDEX "ReplyDispatch_lockedAt_idx" ON "ReplyDispatch"("lockedAt");
CREATE UNIQUE INDEX "BugTicket_classificationId_key" ON "BugTicket"("classificationId");
CREATE INDEX "BugTicket_status_severity_idx" ON "BugTicket"("status", "severity");
CREATE INDEX "BugTicket_threadId_createdAt_idx" ON "BugTicket"("threadId", "createdAt");
CREATE INDEX "BugTicket_artistId_idx" ON "BugTicket"("artistId");
CREATE INDEX "BugTicket_wordpressId_idx" ON "BugTicket"("wordpressId");
CREATE INDEX "BugTicket_artistEmail_idx" ON "BugTicket"("artistEmail");
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

ALTER TABLE "ReplyDispatch" ADD CONSTRAINT "ReplyDispatch_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReplyDispatch" ADD CONSTRAINT "ReplyDispatch_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BugTicket" ADD CONSTRAINT "BugTicket_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BugTicket" ADD CONSTRAINT "BugTicket_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "SafetyControl" (
  "id",
  "shadowMode",
  "externalDeliveryEnabled",
  "reason",
  "updatedAt"
) VALUES (
  'global',
  true,
  false,
  'External delivery is disabled by default for local development.',
  CURRENT_TIMESTAMP
);
