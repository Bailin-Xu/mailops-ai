import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { searchActiveKnowledge } from "@/lib/knowledge/search";

const db = getDb();
const candidateIds = new Set<string>();

afterEach(async () => {
  if (!candidateIds.size) return;
  await db.knowledgeEntry.deleteMany({
    where: { sourceCandidateId: { in: [...candidateIds] } },
  });
  await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  candidateIds.clear();
});

afterAll(async () => { await db.$disconnect(); });

describe("searchActiveKnowledge", () => {
  it("ranks weighted active knowledge and excludes inactive entries", async () => {
    const marker = `ultrazebre${randomUUID().replaceAll("-", "")}`;
    const titleMatch = await createEntry({
      title: `${marker} abonnement`,
      answer: "La règle est confirmée.",
      status: "ACTIVE",
    });
    const answerMatch = await createEntry({
      title: "Règle secondaire",
      answer: `Cette réponse contient ${marker}.`,
      status: "ACTIVE",
    });
    const inactiveMatch = await createEntry({
      title: `${marker} retiré`,
      answer: "Cette règle ne doit pas être utilisée.",
      status: "INACTIVE",
    });

    const results = await searchActiveKnowledge({ q: marker, language: "fr" }, db);

    expect(results.map((result) => result.id)).toEqual([
      titleMatch.id,
      answerMatch.id,
    ]);
    expect(results.some((result) => result.id === inactiveMatch.id)).toBe(false);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("returns no trusted result when active knowledge does not match", async () => {
    await expect(
      searchActiveKnowledge({ q: `absent${randomUUID().replaceAll("-", "")}` }, db),
    ).resolves.toEqual([]);
  });
});

async function createEntry(input: {
  title: string;
  answer: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  const candidate = await db.knowledgeCandidate.create({
    data: {
      fingerprint: `search-integration:${randomUUID()}`,
      title: input.title,
      canonicalQuestion: "Quelle règle synthétique faut-il appliquer ?",
      proposedAnswer: input.answer,
      category: "SEARCH_TEST",
      language: "fr",
      status: "APPROVED",
    },
  });
  candidateIds.add(candidate.id);
  return db.knowledgeEntry.create({
    data: {
      sourceCandidateId: candidate.id,
      title: input.title,
      canonicalQuestion: "Quelle règle synthétique faut-il appliquer ?",
      answer: input.answer,
      category: "SEARCH_TEST",
      language: "fr",
      status: input.status,
      approvedAt: new Date(),
    },
  });
}
