import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import {
  approvePendingCandidatesInView,
  saveCandidateReview,
} from "@/lib/knowledge/candidate-review";

const db = getDb();
const candidateIds = new Set<string>();

afterEach(async () => {
  if (!candidateIds.size) return;
  await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidateIds] } } });
  await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  candidateIds.clear();
});

afterAll(async () => { await db.$disconnect(); });

describe("saveCandidateReview", () => {
  it("creates active knowledge only after human approval and preserves a review event", async () => {
    const candidate = await createCandidate();
    await expect(db.knowledgeEntry.count({ where: { sourceCandidateId: candidate.id } })).resolves.toBe(0);

    await saveCandidateReview(reviewInput(candidate.id, "APPROVED"), db);

    await expect(db.knowledgeEntry.findUnique({ where: { sourceCandidateId: candidate.id } })).resolves.toMatchObject({ status: "ACTIVE", language: "fr" });
    await expect(db.knowledgeCandidateReviewEvent.count({ where: { candidateId: candidate.id } })).resolves.toBe(1);
  });

  it("keeps traceability and deactivates knowledge when a candidate is later rejected", async () => {
    const candidate = await createCandidate();
    await saveCandidateReview(reviewInput(candidate.id, "APPROVED"), db);
    await saveCandidateReview(reviewInput(candidate.id, "REJECTED"), db);

    await expect(db.knowledgeEntry.findUnique({ where: { sourceCandidateId: candidate.id } })).resolves.toMatchObject({ status: "INACTIVE" });
    await expect(db.knowledgeCandidateReviewEvent.count({ where: { candidateId: candidate.id } })).resolves.toBe(2);
  });

  it("bulk-approves only pending candidates matching the confirmed view", async () => {
    const marker = `bulk-${randomUUID()}`;
    const candidate = await createCandidate(marker);

    const result = await approvePendingCandidatesInView(
      { source: "ALL", q: marker, confirmed: "on" },
      db,
    );

    expect(result.approved).toBe(1);
    await expect(
      db.knowledgeEntry.findUnique({ where: { sourceCandidateId: candidate.id } }),
    ).resolves.toMatchObject({ status: "ACTIVE", title: marker });
    await expect(
      db.knowledgeCandidateReviewEvent.findFirst({ where: { candidateId: candidate.id } }),
    ).resolves.toMatchObject({ decision: "APPROVED" });
  });
});

async function createCandidate(title = "Synthetic gallery visit") {
  const candidate = await db.knowledgeCandidate.create({
    data: {
      fingerprint: `integration:${randomUUID()}`,
      title,
      canonicalQuestion: "Faut-il réserver avant de visiter la galerie ?",
      proposedAnswer: "Non, une visite libre ne nécessite pas de rendez-vous.",
      category: "GALLERY_VISIT",
      language: "fr",
    },
  });
  candidateIds.add(candidate.id);
  return candidate;
}

function reviewInput(candidateId: string, decision: "APPROVED" | "REJECTED") {
  return {
    candidateId,
    decision,
    title: "Visite libre de la galerie",
    canonicalQuestion: "Faut-il réserver avant de visiter la galerie ?",
    answer: "Non, une visite libre ne nécessite pas de rendez-vous.",
    category: "GALLERY_VISIT",
    language: "fr",
    note: "Synthetic integration review.",
  };
}
