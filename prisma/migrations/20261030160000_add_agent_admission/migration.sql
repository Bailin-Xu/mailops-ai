CREATE TABLE "AgentAdmission" (
 "id" uuid PRIMARY KEY, "classificationId" uuid NOT NULL REFERENCES "Classification"("id") ON DELETE RESTRICT,
 "context" jsonb NOT NULL, "status" text NOT NULL DEFAULT 'READY', "revision" integer NOT NULL DEFAULT 0,
 "fence" integer NOT NULL DEFAULT 0, "owner" uuid, "claimId" uuid, "claimHash" text, "leaseUntil" timestamp(3),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AgentAdmission_status_check" CHECK ("status" IN ('READY','RUNNING','WAITING_FOR_HUMAN','CANCELLED','STALE','COMMITTED','FAILED'))
);
CREATE INDEX "AgentAdmission_classificationId_status_idx" ON "AgentAdmission"("classificationId","status");
CREATE TABLE "AgentCommitReceipt" (
 "runId" uuid NOT NULL REFERENCES "AgentAdmission"("id") ON DELETE RESTRICT,
 "commandId" uuid NOT NULL, "payloadHash" text NOT NULL, "result" jsonb NOT NULL,
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("runId","commandId")
);
