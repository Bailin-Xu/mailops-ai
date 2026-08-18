import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export const websiteReviewDecisionValues = [
  "CONFIRMED",
  "NEEDS_FOLLOW_UP",
  "REJECTED",
] as const;

export const websiteReviewStatusValues = [
  "PENDING",
  ...websiteReviewDecisionValues,
] as const;

export type WebsiteReviewStatus =
  (typeof websiteReviewStatusValues)[number];

const websiteReviewInputSchema = z
  .object({
    reviewItemId: z.string().uuid(),
    decision: z.enum(websiteReviewDecisionValues),
    confirmedAnswer: z
      .string()
      .trim()
      .max(5000, "The confirmed policy must be 5,000 characters or fewer.")
      .transform((value) => value || null),
    note: z
      .string()
      .trim()
      .max(1000, "Review notes must be 1,000 characters or fewer.")
      .transform((value) => value || null),
  })
  .superRefine((value, context) => {
    if (value.decision === "CONFIRMED" && !value.confirmedAnswer) {
      context.addIssue({
        code: "custom",
        message: "Paste Dorian's confirmed policy before confirming this item.",
        path: ["confirmedAnswer"],
      });
    }
  });

export function parseWebsiteKnowledgeReview(input: unknown) {
  return websiteReviewInputSchema.parse(input);
}

export async function saveWebsiteKnowledgeReview(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const review = parseWebsiteKnowledgeReview(input);
  const reviewedAt = new Date();

  return db.$transaction(async (transaction) => {
    const item = await transaction.websiteKnowledgeReviewItem.findUnique({
      where: { id: review.reviewItemId },
      select: { id: true },
    });

    if (!item) {
      throw new Error("The selected website review item no longer exists.");
    }

    const updated = await transaction.websiteKnowledgeReviewItem.update({
      where: { id: review.reviewItemId },
      data: {
        status: review.decision,
        confirmedAnswer: review.confirmedAnswer,
        reviewNote: review.note,
        reviewedAt,
      },
      select: {
        id: true,
        status: true,
        confirmedAnswer: true,
        reviewNote: true,
        reviewedAt: true,
      },
    });

    await transaction.websiteKnowledgeReviewEvent.create({
      data: {
        reviewItemId: review.reviewItemId,
        decision: review.decision,
        confirmedAnswer: review.confirmedAnswer,
        note: review.note,
        createdAt: reviewedAt,
      },
    });

    return updated;
  });
}
