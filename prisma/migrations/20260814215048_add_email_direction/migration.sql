-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SELF', 'UNKNOWN');

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "direction" "EmailDirection" NOT NULL DEFAULT 'UNKNOWN';

-- CreateIndex
CREATE INDEX "EmailMessage_direction_idx" ON "EmailMessage"("direction");
