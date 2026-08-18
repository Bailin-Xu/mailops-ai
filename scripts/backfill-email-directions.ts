import "dotenv/config";

import { getDb } from "../lib/db";
import { classifyEmailDirection } from "../lib/email/direction";
import { getServerEnv } from "../lib/env";

async function main() {
  const db = getDb();
  const ownedAddresses = getServerEnv().MAILOPS_OWNED_EMAIL_ADDRESSES;
  if (ownedAddresses.length === 0) {
    throw new Error("MAILOPS_OWNED_EMAIL_ADDRESSES must be configured before backfill.");
  }

  const messages = await db.emailMessage.findMany({
    select: {
      id: true,
      direction: true,
      participants: {
        select: {
          type: true,
          displayName: true,
          emailAddress: true,
          normalizedAddress: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const classified = messages.map((message) => ({
    id: message.id,
    previousDirection: message.direction,
    direction: classifyEmailDirection(message.participants, ownedAddresses),
  }));
  const changed = classified.filter(
    (message) => message.direction !== message.previousDirection,
  );

  if (changed.length > 0) {
    await db.$transaction(
      changed.map((message) =>
        db.emailMessage.update({
          where: { id: message.id },
          data: { direction: message.direction },
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
        directionCounts: Object.fromEntries(
          ["INBOUND", "OUTBOUND", "SELF", "UNKNOWN"].map((direction) => [
            direction,
            classified.filter((message) => message.direction === direction).length,
          ]),
        ),
        knowledgeEligible: classified.filter(
          (message) => message.direction === "OUTBOUND",
        ).length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Direction backfill failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
