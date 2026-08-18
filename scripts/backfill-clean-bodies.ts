import "dotenv/config";

import { getDb } from "../lib/db";
import {
  cleanBodyRemovalReasonValues,
  cleanEmailBody,
} from "../lib/email/clean-body";

async function main() {
  const db = getDb();
  const messages = await db.emailMessage.findMany({
    select: {
      id: true,
      normalizedBody: true,
      cleanBody: true,
      quotedContext: true,
      direction: true,
    },
    orderBy: { id: "asc" },
  });

  const cleanedMessages = messages.map((message) => ({
    ...message,
    result: cleanEmailBody(message.normalizedBody),
  }));
  const updates = cleanedMessages.flatMap((message) => {
    const quotedContext =
      message.direction === "OUTBOUND" ? message.result.quotedContext : null;
    if (
      message.result.cleanBody === message.cleanBody &&
      quotedContext === message.quotedContext
    ) {
      return [];
    }

    return [
      db.emailMessage.update({
        where: { id: message.id },
        data: { cleanBody: message.result.cleanBody, quotedContext },
        select: { id: true },
      }),
    ];
  });

  if (updates.length > 0) {
    await db.$transaction(updates);
  }

  const cleaned = cleanedMessages.map((message) => message.result.cleanBody);
  const normalizedCharacters = messages.reduce(
    (total, message) => total + message.normalizedBody.length,
    0,
  );
  const cleanCharacters = cleaned.reduce((total, body) => total + body.length, 0);

  console.log(
    JSON.stringify(
      {
        scanned: messages.length,
        updated: updates.length,
        emptyCleanBodies: cleaned.filter((body) => body.length === 0).length,
        outboundMessages: cleanedMessages.filter(
          (message) => message.direction === "OUTBOUND",
        ).length,
        outboundWithQuotedContext: cleanedMessages.filter(
          (message) =>
            message.direction === "OUTBOUND" &&
            message.result.quotedContext !== null,
        ).length,
        normalizedCharacters,
        cleanCharacters,
        reductionPercent:
          normalizedCharacters === 0
            ? 0
            : Number(
                (((normalizedCharacters - cleanCharacters) / normalizedCharacters) * 100).toFixed(
                  2,
                ),
              ),
        removalReasonCounts: Object.fromEntries(
          cleanBodyRemovalReasonValues.map((reason) => [
            reason,
            cleanedMessages.filter((message) =>
              message.result.removalReasons.includes(reason),
            ).length,
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
    console.error(error instanceof Error ? error.message : "Clean-body backfill failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
