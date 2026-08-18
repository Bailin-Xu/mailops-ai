import "dotenv/config";

import { createHash } from "node:crypto";

import { getDb } from "../lib/db";
import { websiteReviewSeedItems } from "../lib/knowledge/website-review-seed-data";

const capturedAt = new Date("2026-08-17T00:00:00.000Z");

async function main() {
  const db = getDb();

  for (const seedItem of websiteReviewSeedItems) {
    const reviewItem = await db.websiteKnowledgeReviewItem.upsert({
      where: { key: seedItem.key },
      create: {
        key: seedItem.key,
        title: seedItem.title,
        questionForOwner: seedItem.questionForOwner,
        language: "fr",
      },
      update: {
        title: seedItem.title,
        questionForOwner: seedItem.questionForOwner,
      },
      select: { id: true },
    });

    for (const evidence of seedItem.evidence) {
      const source = await db.websiteSource.upsert({
        where: { url: evidence.sourceUrl },
        create: {
          url: evidence.sourceUrl,
          title: evidence.sourceTitle,
          language: "fr",
          capturedAt,
        },
        update: { title: evidence.sourceTitle },
        select: { id: true },
      });
      const evidenceKey = createHash("sha256")
        .update(`${seedItem.key}\n${evidence.sourceUrl}\n${evidence.claim}`)
        .digest("hex");

      await db.websiteKnowledgeEvidence.upsert({
        where: { evidenceKey },
        create: {
          evidenceKey,
          reviewItemId: reviewItem.id,
          sourceId: source.id,
          sectionHeading: evidence.sectionHeading,
          claim: evidence.claim,
        },
        update: {
          sectionHeading: evidence.sectionHeading,
          claim: evidence.claim,
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        reviewItems: websiteReviewSeedItems.length,
        evidence: websiteReviewSeedItems.reduce(
          (total, item) => total + item.evidence.length,
          0,
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
      error instanceof Error ? error.message : "Website review seed failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().$disconnect();
  });
