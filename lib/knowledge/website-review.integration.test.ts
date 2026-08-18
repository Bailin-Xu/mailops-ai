import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { saveWebsiteKnowledgeReview } from "@/lib/knowledge/website-review";

const db = getDb();
const createdItemIds = new Set<string>();

afterAll(async () => {
  await db.$disconnect();
});

describe("saveWebsiteKnowledgeReview", () => {
  afterEach(async () => {
    if (createdItemIds.size) {
      await db.websiteKnowledgeReviewItem.deleteMany({
        where: { id: { in: [...createdItemIds] } },
      });
      createdItemIds.clear();
    }
  });

  it("stores the current policy decision and an immutable review event", async () => {
    const item = await db.websiteKnowledgeReviewItem.create({
      data: {
        key: `integration-${randomUUID()}`,
        title: "Integration policy question",
        questionForOwner: "Quelle règle devons-nous appliquer ?",
      },
    });
    createdItemIds.add(item.id);

    const result = await saveWebsiteKnowledgeReview(
      {
        reviewItemId: item.id,
        decision: "CONFIRMED",
        confirmedAnswer: "La règle confirmée s'applique à tous les nouveaux dossiers.",
        note: "Confirmed for integration test.",
      },
      db,
    );

    expect(result.status).toBe("CONFIRMED");
    expect(result.confirmedAnswer).toContain("règle confirmée");
    await expect(
      db.websiteKnowledgeReviewEvent.count({
        where: { reviewItemId: item.id, decision: "CONFIRMED" },
      }),
    ).resolves.toBe(1);
  });
});
