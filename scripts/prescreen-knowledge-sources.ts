import "dotenv/config";

import { getDb } from "../lib/db";
import {
  assessHistoricalKnowledgeSource,
  knowledgeExclusionReasonValues,
} from "../lib/knowledge/historical-source-assessment";

async function main() {
  const db = getDb();
  const messages = await db.emailMessage.findMany({
    select: {
      id: true,
      direction: true,
      subject: true,
      cleanBody: true,
      quotedContext: true,
      knowledgeSourceStatus: true,
      knowledgeExclusionReasons: true,
    },
    orderBy: { id: "asc" },
  });

  const assessed = messages.map((message) => ({
    id: message.id,
    previousStatus: message.knowledgeSourceStatus,
    previousReasons: message.knowledgeExclusionReasons,
    assessment: assessHistoricalKnowledgeSource(message),
  }));
  const changed = assessed.filter(
    (message) =>
      message.previousStatus !== message.assessment.status ||
      !sameValues(message.previousReasons, message.assessment.exclusionReasons),
  );

  if (changed.length > 0) {
    await db.$transaction(
      changed.map((message) =>
        db.emailMessage.update({
          where: { id: message.id },
          data: {
            knowledgeSourceStatus: message.assessment.status,
            knowledgeExclusionReasons: message.assessment.exclusionReasons,
          },
          select: { id: true },
        }),
      ),
    );
  }

  console.log(
    JSON.stringify(
      {
        scanned: messages.length,
        updated: changed.length,
        statusCounts: {
          READY_FOR_REVIEW: assessed.filter(
            (message) => message.assessment.status === "READY_FOR_REVIEW",
          ).length,
          NEEDS_REVIEW: assessed.filter(
            (message) => message.assessment.status === "NEEDS_REVIEW",
          ).length,
          EXCLUDED: assessed.filter(
            (message) => message.assessment.status === "EXCLUDED",
          ).length,
        },
        exclusionReasonCounts: Object.fromEntries(
          knowledgeExclusionReasonValues.map((reason) => [
            reason,
            assessed.filter((message) =>
              message.assessment.exclusionReasons.includes(reason),
            ).length,
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

function sameValues(first: readonly string[], second: readonly string[]) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Knowledge-source prescreen failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
