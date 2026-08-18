import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { classifyEmailDirection } from "@/lib/email/direction";
import { normalizeSubject } from "@/lib/email/normalize";
import { parseEml } from "@/lib/email/parser";
import { getServerEnv } from "@/lib/env";
import { assessHistoricalKnowledgeSource } from "@/lib/knowledge/historical-source-assessment";
import {
  ingestionResultSchema,
  type IngestionResult,
  type ParsedEmail,
} from "@/lib/email/schemas";

export type IngestEmlOptions = {
  db?: PrismaClient;
  maxFileBytes?: number;
  ownedAddresses?: readonly string[];
};

export async function ingestEml(
  input: Buffer,
  sourceFileName: string,
  options: IngestEmlOptions = {},
): Promise<IngestionResult> {
  const parsed = await parseEml(input, sourceFileName, {
    maxFileBytes: options.maxFileBytes,
  });

  if (parsed.status === "failed") {
    return ingestionResultSchema.parse(parsed);
  }

  const db = options.db ?? getDb();
  const direction = classifyEmailDirection(
    parsed.email.participants,
    options.ownedAddresses ?? getServerEnv().MAILOPS_OWNED_EMAIL_ADDRESSES,
  );
  const quotedContext =
    direction === "OUTBOUND" ? parsed.email.quotedContext : null;
  const knowledgeAssessment = assessHistoricalKnowledgeSource({
    direction,
    subject: parsed.email.subject,
    cleanBody: parsed.email.cleanBody,
    quotedContext,
  });
  try {
    const existing = await findDuplicate(db, parsed.email);

    if (existing) {
      return ingestionResultSchema.parse({
        status: "duplicate",
        existingMessageId: existing.id,
        threadId: existing.threadId,
        matchedBy:
          parsed.email.messageId && existing.messageId === parsed.email.messageId
            ? "MESSAGE_ID"
            : "FINGERPRINT",
      });
    }

    const imported = await db.$transaction(async (transaction) => {
      const thread = await transaction.emailThread.create({
        data: {
          subject: parsed.email.subject,
          normalizedSubject: normalizeSubject(parsed.email.subject),
          isIncomplete: parsed.email.inReplyTo !== null || parsed.email.references.length > 0,
        },
      });

      const message = await transaction.emailMessage.create({
        data: {
          threadId: thread.id,
          messageId: parsed.email.messageId,
          inReplyTo: parsed.email.inReplyTo,
          references: parsed.email.references,
          subject: parsed.email.subject,
          sentAt: parsed.email.sentAt,
          textBody: parsed.email.textBody,
          htmlBody: parsed.email.htmlBody,
          normalizedBody: parsed.email.normalizedBody,
          cleanBody: parsed.email.cleanBody,
          quotedContext,
          direction,
          knowledgeSourceStatus: knowledgeAssessment.status,
          knowledgeExclusionReasons: knowledgeAssessment.exclusionReasons,
          sourceFileName: parsed.email.sourceFileName,
          fingerprint: parsed.email.fingerprint,
          parseStatus: parsed.email.parseStatus,
          parseWarnings: parsed.email.parseWarnings,
          participants: {
            create: parsed.email.participants,
          },
          attachments: {
            create: parsed.email.attachments,
          },
        },
      });

      return { messageId: message.id, threadId: thread.id };
    });

    return ingestionResultSchema.parse({ status: "imported", ...imported });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await findDuplicate(db, parsed.email);
      if (duplicate) {
        return ingestionResultSchema.parse({
          status: "duplicate",
          existingMessageId: duplicate.id,
          threadId: duplicate.threadId,
          matchedBy:
            parsed.email.messageId && duplicate.messageId === parsed.email.messageId
              ? "MESSAGE_ID"
              : "FINGERPRINT",
        });
      }
    }

    return ingestionResultSchema.parse({
      status: "failed",
      error: {
        code: "DATABASE_ERROR",
        message: "The email could not be stored.",
      },
    });
  }
}

async function findDuplicate(db: PrismaClient, email: ParsedEmail) {
  return db.emailMessage.findFirst({
    where: {
      OR: [
        ...(email.messageId ? [{ messageId: email.messageId }] : []),
        { fingerprint: email.fingerprint },
      ],
    },
    select: { id: true, threadId: true, messageId: true, fingerprint: true },
  });
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
