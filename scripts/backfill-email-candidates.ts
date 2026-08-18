import "dotenv/config";

import { getDb } from "../lib/db";
import {
  candidateCleaningReasonValues,
  cleanKnowledgeCandidate,
} from "../lib/knowledge/candidate-cleaner";

const applyChanges = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const candidates = await db.knowledgeCandidate.findMany({
    where: {
      status: "PENDING_REVIEW",
      sources: { some: { sourceType: "EMAIL" } },
    },
    select: {
      id: true,
      title: true,
      canonicalQuestion: true,
      proposedAnswer: true,
      sources: {
        where: { sourceType: "EMAIL" },
        select: {
          emailMessage: {
            select: {
              cleanBody: true,
              quotedContext: true,
              participants: {
                select: { displayName: true },
              },
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const results = candidates.map((candidate) => {
    const sourceMessage = candidate.sources[0]?.emailMessage;
    const knownNames = candidate.sources.flatMap((source) =>
      source.emailMessage?.participants.flatMap((participant) =>
        participant.displayName ? [participant.displayName] : [],
      ) ?? [],
    );
    const cleaned = cleanKnowledgeCandidate({
      title: candidate.title,
      canonicalQuestion:
        sourceMessage?.quotedContext ?? candidate.canonicalQuestion,
      proposedAnswer: sourceMessage?.cleanBody ?? candidate.proposedAnswer,
      knownNames,
    });
    return {
      id: candidate.id,
      cleaned,
      changed:
        cleaned.canonicalQuestion !== candidate.canonicalQuestion ||
        cleaned.proposedAnswer !== candidate.proposedAnswer,
      questionCharactersBefore: candidate.canonicalQuestion.length,
      questionCharactersAfter: cleaned.canonicalQuestion.length,
      answerCharactersBefore: candidate.proposedAnswer.length,
      answerCharactersAfter: cleaned.proposedAnswer.length,
    };
  });
  const changed = results.filter((result) => result.changed);

  if (applyChanges && changed.length) {
    await db.$transaction(
      changed.map((result) =>
        db.knowledgeCandidate.update({
          where: { id: result.id, status: "PENDING_REVIEW" },
          data: {
            canonicalQuestion: result.cleaned.canonicalQuestion,
            proposedAnswer: result.cleaned.proposedAnswer,
          },
        }),
      ),
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? "apply" : "preview",
        scanned: candidates.length,
        changed: changed.length,
        unchanged: results.length - changed.length,
        questionCharactersRemoved: results.reduce(
          (total, result) =>
            total + result.questionCharactersBefore - result.questionCharactersAfter,
          0,
        ),
        answerCharactersRemoved: results.reduce(
          (total, result) =>
            total + result.answerCharactersBefore - result.answerCharactersAfter,
          0,
        ),
        emptyQuestionsAfterCleaning: results.filter(
          (result) => result.cleaned.canonicalQuestion.length === 0,
        ).length,
        emptyAnswersAfterCleaning: results.filter(
          (result) => result.cleaned.proposedAnswer.length === 0,
        ).length,
        reasonCounts: Object.fromEntries(
          candidateCleaningReasonValues.map((reason) => [
            reason,
            results.filter((result) => result.cleaned.reasons.includes(reason)).length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Email candidate backfill failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
