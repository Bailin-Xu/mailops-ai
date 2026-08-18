import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { splitKnowledgeCandidate } from "@/lib/knowledge/candidate-split";

const db = getDb();
let parentId: string | undefined;
let websiteSourceId: string | undefined;

afterEach(async () => {
  if (parentId) {
    await db.knowledgeCandidate.deleteMany({ where: { parentCandidateId: parentId } });
    await db.knowledgeCandidate.deleteMany({ where: { id: parentId } });
    parentId = undefined;
  }
  if (websiteSourceId) {
    await db.websiteSource.deleteMany({ where: { id: websiteSourceId } });
    websiteSourceId = undefined;
  }
});

afterAll(async () => { await db.$disconnect(); });

describe("splitKnowledgeCandidate", () => {
  it("replaces one pending combined candidate with traceable pending children", async () => {
    const source = await db.websiteSource.create({
      data: {
        url: `https://example.test/${randomUUID()}`,
        title: "Synthetic FAQ",
        language: "fr",
        capturedAt: new Date(),
      },
    });
    websiteSourceId = source.id;
    const parent = await db.knowledgeCandidate.create({
      data: {
        fingerprint: `split-parent:${randomUUID()}`,
        title: "Combined FAQ",
        canonicalQuestion: "Question une ? Question deux ?",
        proposedAnswer: "Réponse une. Réponse deux.",
        category: "FAQ",
        language: "fr",
        sources: {
          create: {
            sourceKey: `split-source:${randomUUID()}`,
            sourceType: "WEBSITE",
            websiteSourceId: source.id,
            sourceLabel: "Synthetic FAQ",
            sourceExcerpt: "Preserved combined evidence.",
          },
        },
      },
    });
    parentId = parent.id;

    const result = await splitKnowledgeCandidate(
      {
        candidateId: parent.id,
        segments: [
          { title: "First answer", canonicalQuestion: "Quelle est la première règle ?", proposedAnswer: "Voici la première réponse." },
          { title: "Second answer", canonicalQuestion: "Quelle est la deuxième règle ?", proposedAnswer: "Voici la deuxième réponse." },
        ],
      },
      db,
    );

    expect(result.created).toBe(2);
    await expect(db.knowledgeCandidate.findUnique({ where: { id: parent.id } })).resolves.toMatchObject({ status: "REJECTED" });
    const children = await db.knowledgeCandidate.findMany({
      where: { parentCandidateId: parent.id },
      include: { sources: true },
    });
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.status === "PENDING_REVIEW")).toBe(true);
    expect(children.every((child) => child.sources[0]?.sourceExcerpt === "Preserved combined evidence.")).toBe(true);
    await expect(db.knowledgeCandidateReviewEvent.count({ where: { candidateId: parent.id, decision: "REJECTED" } })).resolves.toBe(1);
  });
});
