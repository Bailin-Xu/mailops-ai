import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { revisionSchema, workflowTransaction } from "@/lib/workflow/transaction";
import { deactivateCandidateKnowledge, publishApprovedKnowledge } from "./revisions";

export const candidateDecisionValues = ["APPROVED", "REJECTED"] as const;
export const candidateStatusValues = [
  "DRAFT",
  "PENDING_REVIEW",
  ...candidateDecisionValues,
] as const;
export type CandidateStatus = (typeof candidateStatusValues)[number];

export function candidateStatusLabel(status: CandidateStatus) {
  return {
    DRAFT: "Draft",
    PENDING_REVIEW: "Pending review",
    APPROVED: "Active knowledge",
    REJECTED: "Rejected",
  }[status];
}

const candidateReviewSchema = z.object({
  candidateId: z.string().uuid(),
  expectedRevision: revisionSchema,
  decision: z.enum(candidateDecisionValues),
  title: z.string().trim().min(3, "Add a clear title.").max(200),
  canonicalQuestion: z
    .string()
    .trim()
    .min(10, "The canonical question must be at least 10 characters.")
    .max(2000),
  answer: z
    .string()
    .trim()
    .min(10, "The reviewed answer must be at least 10 characters.")
    .max(10000),
  category: z.string().trim().min(2, "Add a category.").max(100),
  language: z.enum(["fr", "en"]),
  note: z.string().trim().max(1000).transform((value) => value || null),
});

const bulkCandidateApprovalSchema = z.object({
  source: z.enum(["ALL", "EMAIL", "WEBSITE"]),
  q: z.string().trim().max(200),
  confirmed: z.literal("on", {
    error: "Confirm that you want to activate every pending candidate in this view.",
  }),
});

export function parseCandidateReview(input: unknown) {
  return candidateReviewSchema.parse(input);
}

export function parseBulkCandidateApproval(input: unknown) {
  return bulkCandidateApprovalSchema.parse(input);
}

export async function saveCandidateReview(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const review = parseCandidateReview(input);
  const reviewedAt = new Date();

  return workflowTransaction(db, async (transaction) => {
    const candidate = await transaction.knowledgeCandidate.findUnique({
      where: { id: review.candidateId },
      select: { id: true },
    });
    if (!candidate) throw new Error("The selected candidate no longer exists.");

    const updated = await transaction.knowledgeCandidate.update({
      where: { id: review.candidateId, revision: review.expectedRevision },
      data: {
        revision: { increment: 1 },
        status: review.decision,
        reviewedTitle: review.title,
        reviewedQuestion: review.canonicalQuestion,
        reviewedAnswer: review.answer,
        reviewedCategory: review.category,
        reviewedLanguage: review.language,
        reviewNote: review.note,
        reviewedAt,
      },
    });

    const event = await transaction.knowledgeCandidateReviewEvent.create({
      data: {
        candidateId: review.candidateId,
        decision: review.decision,
        reviewedTitle: review.title,
        reviewedQuestion: review.canonicalQuestion,
        reviewedAnswer: review.answer,
        reviewedCategory: review.category,
        reviewedLanguage: review.language,
        note: review.note,
        createdAt: reviewedAt,
      },
    });

    if (review.decision === "APPROVED") {
      await publishApprovedKnowledge({ candidateId: review.candidateId, reviewEventId: event.id,
        title: review.title, canonicalQuestion: review.canonicalQuestion, answer: review.answer,
        category: review.category, language: review.language, approvedAt: reviewedAt }, transaction);
    } else {
      await deactivateCandidateKnowledge(review.candidateId, transaction);
    }

    return updated;
  });
}

export async function approvePendingCandidatesInView(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const approval = parseBulkCandidateApproval(input);
  const reviewedAt = new Date();

  return workflowTransaction(db, async (transaction) => {
    const candidates = await transaction.knowledgeCandidate.findMany({
      where: {
        status: "PENDING_REVIEW",
        ...(approval.source === "ALL"
          ? {}
          : { sources: { some: { sourceType: approval.source } } }),
        ...(approval.q
          ? {
              OR: [
                { title: { contains: approval.q, mode: "insensitive" as const } },
                {
                  canonicalQuestion: {
                    contains: approval.q,
                    mode: "insensitive" as const,
                  },
                },
                {
                  proposedAnswer: {
                    contains: approval.q,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        revision: true,
        title: true,
        canonicalQuestion: true,
        proposedAnswer: true,
        category: true,
        language: true,
      },
    });

    for (const candidate of candidates) {
      const language = candidate.language === "en" ? "en" : "fr";
      const note = `Bulk-approved by a human from the ${approval.source.toLowerCase()} candidate view.`;
      await transaction.knowledgeCandidate.update({
        where: { id: candidate.id, revision: candidate.revision, status: "PENDING_REVIEW" },
        data: {
          revision: { increment: 1 },
          status: "APPROVED",
          reviewedTitle: candidate.title,
          reviewedQuestion: candidate.canonicalQuestion,
          reviewedAnswer: candidate.proposedAnswer,
          reviewedCategory: candidate.category,
          reviewedLanguage: language,
          reviewNote: note,
          reviewedAt,
        },
      });
      const event = await transaction.knowledgeCandidateReviewEvent.create({
        data: {
          candidateId: candidate.id,
          decision: "APPROVED",
          reviewedTitle: candidate.title,
          reviewedQuestion: candidate.canonicalQuestion,
          reviewedAnswer: candidate.proposedAnswer,
          reviewedCategory: candidate.category,
          reviewedLanguage: language,
          note,
          createdAt: reviewedAt,
        },
      });
      await publishApprovedKnowledge({ candidateId: candidate.id, reviewEventId: event.id,
        title: candidate.title, canonicalQuestion: candidate.canonicalQuestion, answer: candidate.proposedAnswer,
        category: candidate.category, language, approvedAt: reviewedAt }, transaction);
    }

    return { approved: candidates.length };
  });
}
