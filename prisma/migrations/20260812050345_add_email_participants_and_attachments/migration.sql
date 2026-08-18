-- CreateEnum
CREATE TYPE "EmailParticipantType" AS ENUM ('FROM', 'TO', 'CC', 'BCC', 'REPLY_TO');

-- CreateTable
CREATE TABLE "EmailParticipant" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "type" "EmailParticipantType" NOT NULL,
    "displayName" TEXT,
    "emailAddress" TEXT NOT NULL,
    "normalizedAddress" TEXT NOT NULL,

    CONSTRAINT "EmailParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentMetadata" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentId" TEXT,
    "isInline" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AttachmentMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailParticipant_messageId_type_idx" ON "EmailParticipant"("messageId", "type");

-- CreateIndex
CREATE INDEX "EmailParticipant_normalizedAddress_idx" ON "EmailParticipant"("normalizedAddress");

-- CreateIndex
CREATE INDEX "AttachmentMetadata_messageId_idx" ON "AttachmentMetadata"("messageId");

-- AddForeignKey
ALTER TABLE "EmailParticipant" ADD CONSTRAINT "EmailParticipant_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentMetadata" ADD CONSTRAINT "AttachmentMetadata_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
