-- CreateTable
CREATE TABLE "EmailThread" (
    "id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "normalizedSubject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "language" TEXT,
    "isIncomplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "textBody" TEXT,
    "htmlBody" TEXT,
    "normalizedBody" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'PARSED',
    "parseWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailThread_status_idx" ON "EmailThread"("status");

-- CreateIndex
CREATE INDEX "EmailThread_createdAt_idx" ON "EmailThread"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_messageId_key" ON "EmailMessage"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_fingerprint_key" ON "EmailMessage"("fingerprint");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_sentAt_idx" ON "EmailMessage"("sentAt");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
