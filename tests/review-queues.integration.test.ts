import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { syntheticFixtures } from "./support/review-fixtures";
import { getMockInboxQueue, parseInboxFilters } from "@/lib/inbox/queue";
import { getCandidateQueue, parseCandidateFilters } from "@/lib/knowledge/candidate-queue";
import { getKnowledgeHistory, getComparisonRevision } from "@/lib/knowledge/history";
import { saveCandidateReview } from "@/lib/knowledge/candidate-review";

let fixtures: ReturnType<typeof syntheticFixtures>;
beforeEach(() => { fixtures = syntheticFixtures(); });
afterEach(async () => { await fixtures.cleanup(); });
describe("bounded review lists and independent detail", () => {
  it("paginates stable summaries and honors selection outside the visible page instead of silently substituting", async () => {
    const group = `queue${randomUUID().replaceAll("-", "")}`;
    const records = [];
    for (let i = 0; i < 12; i++) records.push(await fixtures.create({ label: group, preGenerate: i === 0 }));
    const db = fixtures.db;
    const first = await getMockInboxQueue(parseInboxFilters({ q: group }), db);
    const second = await getMockInboxQueue(parseInboxFilters({ q: group, page: "2", selected: first.items[0].id }), db);
    expect(first.items).toHaveLength(10); expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(12);
    expect(second.selected?.id).toBe(first.items[0].id);
    expect(first.items.every((item) => !('messages' in item) && item.preview.length <= 240)).toBe(true);
    expect(first.counts).toEqual({ ALL: 12, UNPROCESSED: 11, NEEDS_ACTION: 1, COMPLETED: 0 });
    expect((await getMockInboxQueue(parseInboxFilters({ q: group, status: "NEEDS_ACTION" }), db)).items).toHaveLength(1);
    expect((await getMockInboxQueue(parseInboxFilters({ q: group, page: "999" }), db)).pagination.page).toBe(2);
    expect((await getMockInboxQueue(parseInboxFilters({ q: group, selected: randomUUID() }), db)).selected).toBeNull();
    const candidates = await getCandidateQueue(parseCandidateFilters({ status: "ALL", q: group }), db);
    const next = await getCandidateQueue(parseCandidateFilters({ status: "ALL", q: group, page: "2", selected: candidates.items[0].id }), db);
    expect(candidates.items).toHaveLength(10); expect(next.items).toHaveLength(2);
    expect(next.selected?.id).toBe(candidates.items[0].id);
    expect(candidates.items.every((item) => !('proposedAnswer' in item) && !('reviewEvents' in item))).toBe(true);
    expect((await getCandidateQueue(parseCandidateFilters({ status: "ALL", q: group, selected: randomUUID() }), db)).selected).toBeNull();
    const before = await db.aIExecution.count();
    await getMockInboxQueue(parseInboxFilters({ q: group }), db); await getCandidateQueue(parseCandidateFilters({ status: "ALL", q: group }), db);
    expect(await db.aIExecution.count()).toBe(before);
  });
  it("escapes literal wildcard search and scopes revision comparisons to their knowledge entry", async () => {
    const a = await fixtures.create({ label: "Synthetic100%literal" }), b = await fixtures.create();
    const db = fixtures.db;
    const results = await getMockInboxQueue(parseInboxFilters({ q: "100%literal" }), db);
    expect(results.items.map((item) => item.id)).toEqual([a.threadId]);
    const other = await db.knowledgeEntry.findUniqueOrThrow({ where: { id: b.entryId } });
    expect(await getComparisonRevision(a.entryId, other.currentRevisionId, db)).toBeNull();
    for (let i = 0; i < 11; i++) {
      const current = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: a.candidateId } });
      await saveCandidateReview({ candidateId: a.candidateId, expectedRevision: current.revision, decision: "APPROVED",
        title: a.title, canonicalQuestion: a.question, answer: `Synthetic approved answer version ${i + 2}.`, category: "SHIPPING", language: "en", note: "Synthetic revision page test." }, db);
    }
    const first = await getKnowledgeHistory(a.entryId, db), last = await getKnowledgeHistory(a.entryId, db, 99);
    expect(first?.revisions).toHaveLength(10); expect(last?.revisions).toHaveLength(2);
    expect(last?.pagination.page).toBe(2);
    expect(first?.currentRevision?.version).toBe(12);
  });
});
