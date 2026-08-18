import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export type CandidateSplitSegment = {
  title: string;
  canonicalQuestion: string;
  proposedAnswer: string;
};

const splitCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  segments: z
    .array(
      z.object({
        title: z.string().trim().min(3, "Each split needs a title.").max(200),
        canonicalQuestion: z
          .string()
          .trim()
          .min(10, "Each split needs a clear question.")
          .max(2000),
        proposedAnswer: z.string().trim().max(10000),
      }),
    )
    .min(2, "Create at least two child candidates.")
    .max(10, "A candidate can be split into at most ten children."),
});

export function parseCandidateSplit(input: unknown) {
  return splitCandidateSchema.parse(input);
}

export function suggestCandidateSegments(
  canonicalQuestion: string,
  proposedAnswer: string,
): CandidateSplitSegment[] {
  const answerSections = splitNumberedSections(proposedAnswer);
  if (answerSections.length >= 2) {
    return answerSections.flatMap((section, sectionIndex) => {
      const boundary = section.lastIndexOf("?");
      const question = boundary >= 9 ? section.slice(0, boundary + 1).trim() : "";
      const answer = boundary >= 9 ? section.slice(boundary + 1).trim() : section;
      const atomicQuestions = splitExplicitQuestions(question);
      if (atomicQuestions.length < 2) {
        return [makeSegment(question || `Question ${sectionIndex + 1}`, answer, sectionIndex)];
      }
      return atomicQuestions.map((atomicQuestion, questionIndex) =>
        makeSegment(
          atomicQuestion,
          questionIndex === 0 ? answer : "",
          sectionIndex + questionIndex,
        ),
      );
    });
  }

  const questionSections = splitNumberedSections(canonicalQuestion);
  if (questionSections.length >= 2) {
    const answers = splitNumberedSections(proposedAnswer);
    return questionSections.map((question, index) =>
      makeSegment(question, answers[index] ?? "", index),
    );
  }

  return [
    makeSegment(canonicalQuestion, proposedAnswer, 0),
    makeSegment("Nouvelle question à préciser", "", 1),
  ];
}

export async function splitKnowledgeCandidate(
  input: unknown,
  db: PrismaClient = getDb(),
) {
  const split = parseCandidateSplit(input);
  const splitAt = new Date();

  return db.$transaction(async (transaction) => {
    const parent = await transaction.knowledgeCandidate.findUnique({
      where: { id: split.candidateId },
      include: { sources: true, splitCandidates: { select: { id: true } } },
    });
    if (!parent) throw new Error("The selected candidate no longer exists.");
    if (parent.status !== "PENDING_REVIEW") {
      throw new Error("Only a pending candidate can be split.");
    }
    if (parent.splitCandidates.length) {
      throw new Error("This candidate has already been split.");
    }

    const note = `Split by a human into ${split.segments.length} atomic candidates.`;
    await transaction.knowledgeCandidate.update({
      where: { id: parent.id },
      data: { status: "REJECTED", reviewNote: note, reviewedAt: splitAt },
    });
    await transaction.knowledgeCandidateReviewEvent.create({
      data: {
        candidateId: parent.id,
        decision: "REJECTED",
        note,
        createdAt: splitAt,
      },
    });

    const childIds: string[] = [];
    for (const [index, segment] of split.segments.entries()) {
      const child = await transaction.knowledgeCandidate.create({
        data: {
          fingerprint: `split:${parent.id}:${index + 1}`,
          parentCandidateId: parent.id,
          title: segment.title,
          canonicalQuestion: segment.canonicalQuestion,
          proposedAnswer: segment.proposedAnswer,
          category: parent.category,
          language: parent.language === "en" ? "en" : "fr",
          sources: {
            create: parent.sources.map((source) => ({
              sourceKey: `split:${parent.id}:${index + 1}:${source.id}`,
              sourceType: source.sourceType,
              emailMessageId: source.emailMessageId,
              websiteSourceId: source.websiteSourceId,
              sourceLabel: source.sourceLabel,
              sourceExcerpt: source.sourceExcerpt,
            })),
          },
        },
        select: { id: true },
      });
      childIds.push(child.id);
    }

    return { created: childIds.length, childIds };
  });
}

function splitNumberedSections(value: string) {
  const matches = [...value.matchAll(/^\s*\d+[.)]\s+/gmu)];
  if (matches.length < 2) return [];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? value.length;
    return value.slice(start, end).trim();
  });
}

function splitExplicitQuestions(value: string) {
  return [...value.matchAll(/[^.!?]+[.!?]?/gu)]
    .map((match) => match[0].trim())
    .filter(
      (sentence) =>
        sentence.endsWith("?") ||
        /^(?:je me demandais (?:si|s['’]il)|j'aimerais savoir si|je voudrais savoir si)/iu.test(
          sentence,
        ),
    );
}

function makeSegment(question: string, answer: string, index: number) {
  const normalizedQuestion = question.trim();
  const titleBase = normalizedQuestion
    .replace(/^(?:je me demandais si|y a-t-il|où|comment|pourquoi|est-ce que)\s+/iu, "")
    .replace(/[?!.]+$/u, "")
    .trim();
  return {
    title: (titleBase || `Question ${index + 1}`).slice(0, 120),
    canonicalQuestion: normalizedQuestion,
    proposedAnswer: answer.trim(),
  };
}
