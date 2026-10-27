import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { revisionSchema, workflowTransaction } from "@/lib/workflow/transaction";

export const knowledgeReviewDecisionValues = [
  "APPROVED",
  "NEEDS_FOLLOW_UP",
  "REJECTED",
] as const;

export const knowledgeReviewStatusValues = [
  "PENDING",
  ...knowledgeReviewDecisionValues,
] as const;

export type KnowledgeReviewStatus =
  (typeof knowledgeReviewStatusValues)[number];

const reviewInputSchema = z.object({
  messageId: z.string().uuid(),
  expectedRevision: revisionSchema,
  decision: z.enum(knowledgeReviewDecisionValues),
  note: z
    .string()
    .trim()
    .max(1000, "Review notes must be 1,000 characters or fewer.")
    .transform((value) => value || null),
});

export type KnowledgeSourceReviewInput = z.infer<typeof reviewInputSchema>;

export class KnowledgeSourceReviewError extends Error {}

export function parseKnowledgeSourceReview(input: unknown) {
  return reviewInputSchema.parse(input);
}

export async function saveKnowledgeSourceReview(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const review = parseKnowledgeSourceReview(input);
  const reviewedAt = new Date();

  return workflowTransaction(db, async (transaction) => {
    const message = await transaction.emailMessage.findUnique({
      where: { id: review.messageId },
      select: { id: true, direction: true, cleanBody: true },
    });

    if (!message) {
      throw new KnowledgeSourceReviewError("The selected email no longer exists.");
    }

    if (
      review.decision === "APPROVED" &&
      (message.direction !== "OUTBOUND" || !message.cleanBody.trim())
    ) {
      throw new KnowledgeSourceReviewError(
        "Only an outbound message with a substantive reply can be approved as a source.",
      );
    }

    const updated = await transaction.emailMessage.update({
      where: { id: review.messageId, knowledgeReviewRevision: review.expectedRevision },
      data: {
        knowledgeReviewRevision: { increment: 1 },
        knowledgeReviewStatus: review.decision,
        knowledgeReviewNote: review.note,
        knowledgeReviewedAt: reviewedAt,
      },
      select: {
        id: true,
        knowledgeReviewRevision: true,
        knowledgeReviewStatus: true,
        knowledgeReviewNote: true,
        knowledgeReviewedAt: true,
      },
    });

    await transaction.knowledgeSourceReviewEvent.create({
      data: {
        messageId: review.messageId,
        decision: review.decision,
        note: review.note,
        createdAt: reviewedAt,
      },
    });

    return updated;
  });
}
