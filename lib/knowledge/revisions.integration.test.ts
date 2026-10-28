import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AIProvider, DraftInput } from "@/lib/ai/provider";
import { confirmAndSimulateSend, runAutomaticProcessing, runThreadAutomation } from "@/lib/processing/service";
import { draftInputSnapshotSchema } from "@/lib/processing/evidence";
import { WorkflowConflictError } from "@/lib/workflow/transaction";
import { saveCandidateReview, approvePendingCandidatesInView } from "./candidate-review";
import { captureApprovedKnowledge, retireKnowledge } from "./revisions";
import { getAffectedDrafts, getDraftEvidence, getKnowledgeHistory } from "./history";
import { searchActiveKnowledge } from "./search";

const db = getDb();
const candidateIds = new Set<string>();
const threadIds = new Set<string>();
const providerId = `knowledge-versions-${randomUUID()}`;
const mock = new MockAIProvider();
const ai: AIProvider = {
  id: providerId, model: "deterministic", classificationPromptVersion: "test-v1", draftPromptVersion: "test-v1",
  classifyEmail: async () => ({ category: "KNOWN_QUESTION", confidence: 0.95, language: "en", requiresHumanReview: false }),
  generateDraft: (input) => mock.generateDraft(input),
};

afterEach(async () => {
  const ids = [...threadIds];
  await db.draftKnowledgeSource.deleteMany({ where: { draft: { threadId: { in: ids } } } });
  await db.draft.deleteMany({ where: { threadId: { in: ids } } });
  await db.classification.deleteMany({ where: { threadId: { in: ids } } });
  await db.aIExecution.deleteMany({ where: { provider: providerId } });
  await db.emailMessage.deleteMany({ where: { threadId: { in: ids } } });
  await db.emailThread.deleteMany({ where: { id: { in: ids } } });
  const entries = await db.knowledgeEntry.findMany({ where: { sourceCandidateId: { in: [...candidateIds] } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { entityType: "KnowledgeEntry", entityId: { in: entries.map((entry) => entry.id) } } });
  await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidateIds] } } });
  await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  candidateIds.clear(); threadIds.clear();
});
afterAll(() => db.$disconnect());

async function fixture() {
  const marker = `revision${randomUUID().replaceAll("-", "")}`;
  const input = { title: `${marker} shipping`, canonicalQuestion: `How does ${marker} shipping work?`,
    answer: "Version A: tracked delivery is included.", category: "SHIPPING", language: "en", note: "Synthetic human approval.", decision: "APPROVED" };
  const candidate = await db.knowledgeCandidate.create({ data: { fingerprint: randomUUID(), title: input.title,
    canonicalQuestion: input.canonicalQuestion, proposedAnswer: input.answer, category: input.category, language: input.language } });
  candidateIds.add(candidate.id);
  await saveCandidateReview({ ...input, candidateId: candidate.id, expectedRevision: 0 }, db);
  const entry = await db.knowledgeEntry.findUniqueOrThrow({ where: { sourceCandidateId: candidate.id }, include: { currentRevision: true } });
  const thread = await db.emailThread.create({ data: { subject: input.title, normalizedSubject: marker,
    messages: { create: { subject: input.title, normalizedBody: input.canonicalQuestion, cleanBody: input.canonicalQuestion,
      direction: "INBOUND", fingerprint: randomUUID(), sourceFileName: "synthetic-revision.eml" } },
  } });
  threadIds.add(thread.id);
  const classification = await runThreadAutomation(thread.id, ai, db);
  const draft = await db.draft.findFirstOrThrow({ where: { classificationId: classification.id } });
  return { candidate, entry, thread, classification, draft, input, marker };
}

async function revise(f: Awaited<ReturnType<typeof fixture>>, answer = "Version B: collection is available instead.") {
  const current = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: f.candidate.id } });
  return saveCandidateReview({ ...f.input, candidateId: current.id, expectedRevision: current.revision, answer }, db);
}
function confirm(id: string) {
  return confirmAndSimulateSend({ draftId: id, subject: "Human-reviewed subject", body: "Exact approved final text. Réponse vérifiée.", language: "fr" }, db);
}

describe("immutable knowledge revisions and draft evidence", () => {
  it("retains A evidence after publication of B, blocks the affected draft, then generates from B", async () => {
    const f = await fixture();
    const before = await getDraftEvidence(f.draft.id, db);
    expect(before?.provenanceComplete).toBe(true);
    expect(before?.sources[0].revision).toMatchObject({ version: 1, answer: f.input.answer, origin: "HUMAN_APPROVAL" });
    expect(before?.inputSnapshot).toMatchObject({ subject: f.input.title, cleanBody: f.input.canonicalQuestion,
      style: { profile: "DORIAN_REFERENCE" }, factualGrounding: { revisionIds: [f.entry.currentRevisionId] } });
    await revise(f);
    const history = await getKnowledgeHistory(f.entry.id, db);
    expect(history?.revisions.map((revision) => revision.version)).toEqual([2, 1]);
    expect(history?.revisions[1].answer).toBe(f.input.answer);
    expect(history?.revisions.every((revision) => revision.reviewEvent?.decision === "APPROVED")).toBe(true);
    const old = await getDraftEvidence(f.draft.id, db);
    expect(old?.sources[0].revision?.answer).toBe(f.input.answer);
    expect(old?.inputSnapshot).toEqual(before?.inputSnapshot);
    const affected = await getAffectedDrafts({ knowledgeEntryId: f.entry.id }, db);
    expect(affected.items).toHaveLength(1);
    expect(affected.items[0]).toMatchObject({ id: f.draft.id, knowledgeReviewReason: "KNOWLEDGE_REVISED" });
    await expect(confirm(f.draft.id)).rejects.toBeInstanceOf(WorkflowConflictError);
    const replacement = await runAutomaticProcessing(f.classification.id, ai, db);
    const evidence = await getDraftEvidence(replacement.id, db);
    expect(evidence?.sources[0].revision).toMatchObject({ version: 2, answer: history!.currentRevision!.answer });
    expect(await db.draft.findUnique({ where: { id: replacement.id } })).toMatchObject({ knowledgeReviewRequiredAt: null, evidenceStatus: "CAPTURED" });
    expect((await getAffectedDrafts({ knowledgeEntryId: f.entry.id }, db)).items).toHaveLength(0);
    await confirm(replacement.id);
  });

  it("does not mark or rewrite a confirmed reply when its knowledge changes", async () => {
    const f = await fixture();
    await confirm(f.draft.id);
    const before = await db.draft.findUniqueOrThrow({ where: { id: f.draft.id } });
    await revise(f);
    const stored = await db.draft.findUniqueOrThrow({ where: { id: f.draft.id } });
    expect(stored).toEqual(before);
    expect((await getAffectedDrafts({ knowledgeEntryId: f.entry.id }, db)).items).toEqual([]);
    expect((await getDraftEvidence(f.draft.id, db))?.sources[0].revision?.version).toBe(1);
  });

  it.each(["INACTIVE", "ARCHIVED"] as const)("marks pending drafts when knowledge becomes %s and excludes it from retrieval", async (status) => {
    const f = await fixture();
    const result = await retireKnowledge({ knowledgeEntryId: f.entry.id, expectedRevisionId: f.entry.currentRevisionId, status }, db);
    expect(result.affectedDrafts).toBe(1);
    expect((await getAffectedDrafts({ knowledgeEntryId: f.entry.id }, db)).items[0].knowledgeReviewReason).toBe("KNOWLEDGE_RETIRED");
    expect(await searchActiveKnowledge({ q: f.marker, language: "en" }, db)).toEqual([]);
    await expect(confirm(f.draft.id)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect((await getDraftEvidence(f.draft.id, db))?.sources[0].revision?.answer).toBe(f.input.answer);
    await expect(saveCandidateReview({ ...f.input, candidateId: f.candidate.id, expectedRevision: 1 }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect((await getKnowledgeHistory(f.entry.id, db))?.status).toBe(status);
  });

  it("preserves approved revisions through rejection and later reapproval", async () => {
    const f = await fixture();
    await saveCandidateReview({ ...f.input, candidateId: f.candidate.id, expectedRevision: 1, decision: "REJECTED" }, db);
    expect((await getKnowledgeHistory(f.entry.id, db))?.revisions).toHaveLength(1);
    expect((await getAffectedDrafts({ knowledgeEntryId: f.entry.id }, db)).items).toHaveLength(1);
    await revise(f);
    const history = await getKnowledgeHistory(f.entry.id, db);
    expect(history?.currentRevision?.version).toBe(2);
    expect(history?.revisions[1].answer).toBe(f.input.answer);
  });

  it.each(["revise", "retire"])("rejects generation started with A when a concurrent action is %s", async (change) => {
    const f = await fixture();
    let started!: () => void; let release!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let observed: DraftInput | undefined;
    const blocked: AIProvider = { ...ai, generateDraft: async (input) => {
      observed = input; started(); await barrier; return mock.generateDraft(input);
    } };
    const outcome = Promise.allSettled([runAutomaticProcessing(f.classification.id, blocked, db)]);
    await began;
    if (change === "revise") await revise(f);
    else await retireKnowledge({ knowledgeEntryId: f.entry.id, expectedRevisionId: f.entry.currentRevisionId, status: "INACTIVE" }, db);
    release();
    expect((await outcome)[0].status).toBe("rejected");
    expect(observed?.knowledge[0].answer).toBe(f.input.answer);
    expect(await db.draft.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect((await getDraftEvidence(f.draft.id, db))?.sources[0].revision?.version).toBe(1);
    expect(await db.aIExecution.count({ where: { provider: providerId, validationErrors: { has: "STALE_CONTEXT" } } })).toBe(1);
  });

  it("rejects stale lifecycle changes and creates only one competing approved revision", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      saveCandidateReview({ ...f.input, candidateId: f.candidate.id, expectedRevision: 1, answer: "Competing B." }, db),
      saveCandidateReview({ ...f.input, candidateId: f.candidate.id, expectedRevision: 1, answer: "Competing C." }, db),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await getKnowledgeHistory(f.entry.id, db))?.revisions).toHaveLength(2);
    await expect(retireKnowledge({ knowledgeEntryId: f.entry.id, expectedRevisionId: f.entry.currentRevisionId, status: "INACTIVE" }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
  });

  it("protects revision content, input snapshots, source bindings, and current-pointer ownership in the database", async () => {
    const f = await fixture();
    await expect(db.knowledgeRevision.update({ where: { id: f.entry.currentRevisionId! }, data: { answer: "Tampered" } })).rejects.toThrow();
    await expect(db.knowledgeRevision.delete({ where: { id: f.entry.currentRevisionId! } })).rejects.toThrow();
    await expect(db.draft.update({ where: { id: f.draft.id }, data: { inputSnapshot: { forged: true } } })).rejects.toThrow();
    await revise(f);
    const current = await db.knowledgeEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
    await expect(db.draftKnowledgeSource.update({ where: { draftId_knowledgeEntryId: { draftId: f.draft.id, knowledgeEntryId: f.entry.id } },
      data: { knowledgeRevisionId: current.currentRevisionId } })).rejects.toThrow();
    const second = await fixture();
    await expect(db.knowledgeEntry.update({ where: { id: second.entry.id }, data: { currentRevisionId: current.currentRevisionId } })).rejects.toThrow();
    expect((await getDraftEvidence(f.draft.id, db))?.sources[0].revision?.answer).toBe(f.input.answer);
  });

  it("creates revisions for bulk approval and labels on-demand legacy baselines honestly", async () => {
    const f = await fixture();
    const marker = `bulkversion${randomUUID()}`;
    const pending = await db.knowledgeCandidate.create({ data: { fingerprint: randomUUID(), title: marker,
      canonicalQuestion: "How does tracked delivery work?", proposedAnswer: "A synthetic answer.", category: "SHIPPING", language: "en" } });
    candidateIds.add(pending.id);
    await approvePendingCandidatesInView({ source: "ALL", q: marker, confirmed: "on" }, db);
    const approved = await db.knowledgeEntry.findUniqueOrThrow({ where: { sourceCandidateId: pending.id }, include: { currentRevision: true } });
    expect(approved.currentRevision).toMatchObject({ version: 1, origin: "HUMAN_APPROVAL" });
    const rawCandidate = await db.knowledgeCandidate.create({ data: { fingerprint: randomUUID(), title: "Legacy entry", canonicalQuestion: "An old question?",
      proposedAnswer: "An old approved answer.", category: "SHIPPING", language: "en", status: "APPROVED" } });
    candidateIds.add(rawCandidate.id);
    const raw = await db.knowledgeEntry.create({ data: { sourceCandidateId: rawCandidate.id, title: "Legacy entry", canonicalQuestion: "An old question?",
      answer: "An old approved answer.", category: "SHIPPING", language: "en", approvedAt: new Date("2020-01-01") } });
    const baseline = await captureApprovedKnowledge(raw.id, db);
    expect(baseline.revision.origin).toBe("LEGACY_BASELINE");
    expect(baseline.revision.recordedAt.getTime()).toBeGreaterThan(baseline.revision.approvedAt.getTime());
    expect(draftInputSnapshotSchema.safeParse(f.draft.inputSnapshot).success).toBe(true);
  });

  it("paginates affected drafts and supports entry-specific impact lookup", async () => {
    const first = await fixture(); const second = await fixture();
    await revise(first); await revise(second);
    const page1 = await getAffectedDrafts({ limit: 1 }, db);
    expect(page1.items).toHaveLength(1); expect(page1.nextCursor).not.toBeNull();
    const page2 = await getAffectedDrafts({ limit: 1, cursor: page1.nextCursor }, db);
    expect(page2.items).toHaveLength(1); expect(page2.nextCursor).toBeNull();
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
    expect((await getAffectedDrafts({ knowledgeEntryId: first.entry.id }, db)).items.map((item) => item.id)).toEqual([first.draft.id]);
  });
});
