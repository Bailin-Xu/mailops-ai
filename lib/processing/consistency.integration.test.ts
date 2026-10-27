import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { ClassificationCategory } from "@/generated/prisma/client";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import type { AIProvider, DraftInput } from "@/lib/ai/provider";
import { reviewClassification, runThreadClassification } from "@/lib/classification/service";
import { getDb } from "@/lib/db";
import { confirmAndSimulateSend, runAutomaticProcessing, runThreadAutomation, simulateForwardToDiscord, submitManualAnswer } from "./service";
import { WorkflowConflictError } from "@/lib/workflow/transaction";

const db = getDb();
const threadIds = new Set<string>();
const candidateIds = new Set<string>();
const providerId = `consistency-${randomUUID()}`;

afterEach(async () => {
  const ids = [...threadIds];
  const classifications = await db.classification.findMany({ where: { threadId: { in: ids } }, select: { id: true } });
  await db.draftKnowledgeSource.deleteMany({ where: { draft: { threadId: { in: ids } } } });
  await db.draft.deleteMany({ where: { threadId: { in: ids } } });
  await db.knowledgeCandidateSource.deleteMany({ where: { emailMessage: { threadId: { in: ids } } } });
  await db.knowledgeCandidate.deleteMany({ where: { fingerprint: { in: classifications.map((row) => `manual-answer:${row.id}`) } } });
  await db.classification.deleteMany({ where: { threadId: { in: ids } } });
  await db.aIExecution.deleteMany({ where: { provider: providerId } });
  await db.emailMessage.deleteMany({ where: { threadId: { in: ids } } });
  await db.emailThread.deleteMany({ where: { id: { in: ids } } });
  await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidateIds] } } });
  await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  threadIds.clear(); candidateIds.clear();
});
afterAll(() => db.$disconnect());

function provider(options: {
  category?: ClassificationCategory;
  generate?: (input: DraftInput) => Promise<unknown>;
  classify?: AIProvider["classifyEmail"];
} = {}): AIProvider {
  const mock = new MockAIProvider();
  return {
    id: providerId, model: "deterministic", classificationPromptVersion: "test-v1", draftPromptVersion: "test-v1",
    classifyEmail: options.classify ?? (async () => ({
      category: options.category ?? "KNOWN_QUESTION", confidence: 0.95, language: "en", requiresHumanReview: false,
    })),
    generateDraft: options.generate ?? ((input) => mock.generateDraft(input)),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function blockedDraft() {
  const started = deferred();
  const release = deferred();
  const ai = provider({ generate: async (input) => {
    started.resolve();
    await release.promise;
    return new MockAIProvider().generateDraft(input);
  } });
  return { started, release, ai };
}

async function fixture(category: ClassificationCategory = "KNOWN_QUESTION") {
  const marker = `parcel${randomUUID().replaceAll("-", "")}`;
  const thread = await db.emailThread.create({ data: {
    subject: `${marker} shipping policy`, normalizedSubject: marker,
    messages: { create: {
      subject: `${marker} shipping policy`, normalizedBody: `How does ${marker} shipping work?`,
      cleanBody: `How does ${marker} shipping work?`, direction: "INBOUND",
      fingerprint: randomUUID(), sourceFileName: "synthetic-consistency.eml", sentAt: new Date(),
    } },
  }, include: { messages: true } });
  threadIds.add(thread.id);
  const candidate = await db.knowledgeCandidate.create({ data: {
    fingerprint: randomUUID(), title: marker, canonicalQuestion: `How does ${marker} shipping work?`,
    proposedAnswer: "Tracked shipping is included in this synthetic policy.", category: "KNOWN_QUESTION", language: "en", status: "APPROVED",
    knowledgeEntry: { create: {
      title: marker, canonicalQuestion: `How does ${marker} shipping work?`,
      answer: "Tracked shipping is included in this synthetic policy.", category: "KNOWN_QUESTION", language: "en", approvedAt: new Date(),
    } },
  }, include: { knowledgeEntry: true } });
  candidateIds.add(candidate.id);
  const classification = await runThreadAutomation(thread.id, provider({ category }), db);
  const draft = await db.draft.findFirst({ where: { classificationId: classification.id } });
  return { thread, classification, draft, knowledge: candidate.knowledgeEntry! };
}

const finalText = { subject: "Reviewed subject", body: "Exact human-reviewed reply. Également en français.", language: "fr" };
async function confirm(draftId: string) {
  return confirmAndSimulateSend({ draftId, ...finalText }, db);
}

describe("draft validity and replacement", () => {
  it("rejects old drafts after a new classification, preserving final history", async () => {
    const f = await fixture();
    await runThreadAutomation(f.thread.id, provider(), db);
    await expect(confirm(f.draft!.id)).rejects.toThrow("no longer ready");
    const current = await db.draft.findFirstOrThrow({ where: { threadId: f.thread.id, status: "GENERATED" } });
    await confirm(current.id);
    await expect(db.draft.findUnique({ where: { id: current.id } })).resolves.toMatchObject({
      approvedSubject: finalText.subject, approvedBody: finalText.body, approvedLanguage: "fr", status: "SIMULATED_SENT",
    });
    await expect(runThreadAutomation(f.thread.id, provider(), db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(runAutomaticProcessing(current.classificationId, provider(), db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(confirm(current.id)).rejects.toThrow("no longer ready");
    expect(await db.draft.count({ where: { threadId: f.thread.id, status: "SIMULATED_SENT" } })).toBe(1);
  });

  it.each(["new-message", "edited-message", "retired-knowledge", "changed-knowledge"])(
    "rejects confirmation when context changed: %s", async (change) => {
      const f = await fixture();
      if (change === "new-message") {
        await db.emailMessage.create({ data: { threadId: f.thread.id, subject: "Another question", normalizedBody: "New inbound context",
          direction: "INBOUND", fingerprint: randomUUID(), sourceFileName: "synthetic-new.eml", sentAt: new Date(Date.now() + 1000) } });
      } else if (change === "edited-message") {
        await db.emailMessage.update({ where: { id: f.thread.messages[0].id }, data: { cleanBody: "The request has changed." } });
      } else {
        await db.knowledgeEntry.update({ where: { id: f.knowledge.id }, data: change === "retired-knowledge"
          ? { status: "INACTIVE" } : { answer: "The approved policy changed." } });
      }
      await expect(confirm(f.draft!.id)).rejects.toBeInstanceOf(WorkflowConflictError);
      expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "GENERATED", approvedAt: null });
      expect(await db.classification.findUnique({ where: { id: f.classification.id } })).toMatchObject({ processingStatus: "DRAFT_READY" });
    },
  );

  it("requires a new classification for legacy drafts without verified context", async () => {
    const f = await fixture();
    await db.classification.update({ where: { id: f.classification.id }, data: { sourceContextHash: null } });
    await expect(confirm(f.draft!.id)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(runAutomaticProcessing(f.classification.id, provider(), db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await runThreadAutomation(f.thread.id, provider(), db);
    expect(await db.draft.count({ where: { threadId: f.thread.id, status: "GENERATED" } })).toBe(1);
  });

  it.each(["provider", "schema", "grounding"])("preserves an existing reply when replacement fails: %s", async (failure) => {
    const f = await fixture();
    const failing = provider({ generate: async (input) => {
      if (failure === "provider") throw new Error("Synthetic provider failure");
      if (failure === "schema") return { body: "invalid" };
      return { ...await new MockAIProvider().generateDraft(input), knowledgeSourceIds: [randomUUID()] };
    } });
    await expect(runAutomaticProcessing(f.classification.id, failing, db)).rejects.toThrow(/Draft/);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "GENERATED", body: f.draft!.body });
    expect(await db.classification.findUnique({ where: { id: f.classification.id } })).toMatchObject({ processingStatus: "DRAFT_READY" });
    expect(await db.aIExecution.count({ where: { provider: providerId, taskType: "DRAFT_GENERATION", status: "FAILED" } })).toBe(1);
    await confirm(f.draft!.id);
  });

  it("marks a failed first attempt recoverable, then succeeds without repeating classification", async () => {
    const f = await fixture("BUSINESS_PARTNERSHIP");
    const corrected = await reviewClassification({ classificationId: f.classification.id,
      expectedRevision: f.classification.revision, category: "KNOWN_QUESTION" }, db);
    await expect(runAutomaticProcessing(corrected.id, provider({ generate: async () => { throw new Error(); } }), db)).rejects.toThrow("Draft generation");
    expect(await db.classification.findUnique({ where: { id: corrected.id } })).toMatchObject({ processingStatus: "FAILED" });
    await runAutomaticProcessing(corrected.id, provider(), db);
    expect(await db.classification.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect(await db.draft.count({ where: { threadId: f.thread.id, status: "GENERATED" } })).toBe(1);
  });

  it("activates only one concurrent replacement and supersedes old content atomically", async () => {
    const f = await fixture();
    const first = blockedDraft(); const second = blockedDraft();
    const outcomes = Promise.allSettled([
      runAutomaticProcessing(f.classification.id, first.ai, db), runAutomaticProcessing(f.classification.id, second.ai, db),
    ]);
    await Promise.all([first.started.promise, second.started.promise]);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "GENERATED" });
    first.release.resolve(); second.release.resolve();
    const results = await outcomes;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.draft.count({ where: { threadId: f.thread.id, status: "GENERATED" } })).toBe(1);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "SUPERSEDED" });
  });

  it.each(["knowledge", "correction", "new-message", "confirmed"])("discards an in-flight result after %s changes", async (change) => {
    const f = await fixture(); const pending = blockedDraft();
    const outcome = Promise.allSettled([runAutomaticProcessing(f.classification.id, pending.ai, db)]);
    await pending.started.promise;
    if (change === "knowledge") {
      await db.knowledgeEntry.update({ where: { id: f.knowledge.id }, data: { status: "INACTIVE" } });
    } else if (change === "correction") {
      await reviewClassification({ classificationId: f.classification.id, expectedRevision: f.classification.revision, category: "TECHNICAL_ISSUE" }, db);
    } else if (change === "new-message") {
      await db.emailMessage.create({ data: { threadId: f.thread.id, subject: "New request", normalizedBody: "Changed request", direction: "INBOUND",
        sourceFileName: "synthetic-new.eml", fingerprint: randomUUID(), sentAt: new Date(Date.now() + 1000) } });
    } else {
      await confirm(f.draft!.id);
    }
    pending.release.resolve();
    expect((await outcome)[0].status).toBe("rejected");
    expect(await db.draft.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect(await db.aIExecution.count({ where: { provider: providerId, status: "FAILED", validationErrors: { has: "STALE_CONTEXT" } } })).toBe(1);
    if (change === "confirmed") expect(await db.classification.findUnique({ where: { id: f.classification.id } })).toMatchObject({ processingStatus: "SIMULATED_SENT" });
  });

  it("does not let a late provider failure overwrite a newer successful replacement", async () => {
    const f = await fixture(); const started = deferred(); const release = deferred();
    const slowFailure = provider({ generate: async () => { started.resolve(); await release.promise; throw new Error(); } });
    const outcome = Promise.allSettled([runAutomaticProcessing(f.classification.id, slowFailure, db)]);
    await started.promise;
    const successful = await runAutomaticProcessing(f.classification.id, provider(), db);
    release.resolve(); await outcome;
    expect(await db.classification.findUnique({ where: { id: f.classification.id } })).toMatchObject({ processingStatus: "DRAFT_READY" });
    expect(await db.draft.findUnique({ where: { id: successful.id } })).toMatchObject({ status: "GENERATED" });
  });
});

describe("classification and human action consistency", () => {
  it.each(["provider", "schema"])("preserves the previous classification and draft when classification fails: %s", async (failure) => {
    const f = await fixture();
    const failing = provider({ classify: async () => {
      if (failure === "provider") throw new Error("Synthetic failure");
      return { category: "INVALID" };
    } });
    await expect(runThreadClassification(f.thread.id, failing, db)).rejects.toThrow(/Classification/);
    expect(await db.classification.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "GENERATED" });
    await confirm(f.draft!.id);
  });

  it("accepts only one classification result from concurrent attempts on the same revision", async () => {
    const f = await fixture(); const first = deferred(); const second = deferred(); const release = deferred();
    const paused = (started: ReturnType<typeof deferred>) => provider({ classify: async () => {
      started.resolve(); await release.promise;
      return { category: "KNOWN_QUESTION", confidence: 0.95, language: "en", requiresHumanReview: false };
    } });
    const outcome = Promise.allSettled([
      runThreadClassification(f.thread.id, paused(first), db), runThreadClassification(f.thread.id, paused(second), db),
    ]);
    await Promise.all([first.promise, second.promise]); release.resolve();
    expect((await outcome).filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.classification.count({ where: { threadId: f.thread.id } })).toBe(2);
  });

  it("confirms only one competing final text without overwriting the winner", async () => {
    const f = await fixture();
    const texts = ["First human-approved text.", "Second human-approved text."];
    const results = await Promise.allSettled(texts.map((body) => confirmAndSimulateSend({ draftId: f.draft!.id, ...finalText, body }, db)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const index = results.findIndex((result) => result.status === "fulfilled");
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ approvedBody: texts[index], status: "SIMULATED_SENT" });
  });

  it("starts a fresh workflow for a genuinely new inbound message without changing confirmed history", async () => {
    const f = await fixture();
    await confirm(f.draft!.id);
    await db.emailMessage.create({ data: {
      threadId: f.thread.id, subject: f.thread.subject, normalizedBody: f.thread.messages[0].cleanBody,
      direction: "INBOUND", fingerprint: randomUUID(), sourceFileName: "synthetic-followup.eml", sentAt: new Date(Date.now() + 1000),
    } });
    const current = await runThreadAutomation(f.thread.id, provider(), db);
    expect(current.processingStatus).toBe("DRAFT_READY");
    expect(current.threadRevision).toBe(f.classification.threadRevision! + 1);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "SIMULATED_SENT", approvedBody: finalText.body });
    expect(await db.draft.count({ where: { threadId: f.thread.id, status: "GENERATED" } })).toBe(1);
  });

  it("rejects stale and concurrent classification corrections without overwriting the winner", async () => {
    const f = await fixture();
    const input = { classificationId: f.classification.id, expectedRevision: f.classification.revision };
    const results = await Promise.allSettled([
      reviewClassification({ ...input, category: "TECHNICAL_ISSUE" }, db),
      reviewClassification({ ...input, category: "BUSINESS_PARTNERSHIP" }, db),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = await db.classification.findUniqueOrThrow({ where: { id: f.classification.id } });
    await expect(reviewClassification({ ...input, category: "KNOWN_QUESTION" }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.classification.findUnique({ where: { id: stored.id } })).toMatchObject({ reviewedCategory: stored.reviewedCategory, revision: stored.revision });
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "SUPERSEDED" });
  });

  it("rejects classification results computed before a new message arrived", async () => {
    const f = await fixture(); const started = deferred(); const release = deferred();
    const slow = provider({ classify: async () => { started.resolve(); await release.promise;
      return { category: "KNOWN_QUESTION", confidence: 0.95, language: "en", requiresHumanReview: false }; } });
    const outcome = Promise.allSettled([runThreadClassification(f.thread.id, slow, db)]);
    await started.promise;
    await db.emailMessage.create({ data: { threadId: f.thread.id, subject: "New", normalizedBody: "New inbound",
      direction: "INBOUND", fingerprint: randomUUID(), sourceFileName: "synthetic-new.eml" } });
    release.resolve(); expect((await outcome)[0].status).toBe("rejected");
    expect(await db.classification.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect(await db.draft.findUnique({ where: { id: f.draft!.id } })).toMatchObject({ status: "GENERATED" });
  });

  it("allows only one concurrent manual answer and candidate, and requires the displayed revision", async () => {
    const f = await fixture("BUSINESS_PARTNERSHIP");
    const input = { classificationId: f.classification.id, expectedRevision: f.classification.revision,
      body: "The human has verified this synthetic answer.", createCandidate: true };
    await expect(submitManualAnswer({ ...input, expectedRevision: input.expectedRevision + 1 }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.draft.count({ where: { threadId: f.thread.id } })).toBe(0);
    const results = await Promise.allSettled([submitManualAnswer(input, db), submitManualAnswer(input, db)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.draft.count({ where: { threadId: f.thread.id } })).toBe(1);
    expect(await db.knowledgeCandidate.count({ where: { fingerprint: `manual-answer:${f.classification.id}` } })).toBe(1);
    await expect(submitManualAnswer(input, db)).rejects.toBeInstanceOf(WorkflowConflictError);
  });

  it("rolls back the manual reply and status if candidate creation fails", async () => {
    const f = await fixture("BUSINESS_PARTNERSHIP");
    await db.knowledgeCandidate.create({ data: { fingerprint: `manual-answer:${f.classification.id}`,
      title: "Existing synthetic candidate", canonicalQuestion: "An existing question?", proposedAnswer: "An existing answer.", category: "TEST", language: "en" } });
    await expect(submitManualAnswer({ classificationId: f.classification.id, expectedRevision: f.classification.revision,
      body: "A synthetic answer.", createCandidate: true }, db)).rejects.toMatchObject({ code: "P2002" });
    expect(await db.classification.findUnique({ where: { id: f.classification.id } })).toMatchObject({
      revision: f.classification.revision, processingStatus: "AWAITING_HUMAN_ANSWER",
    });
    expect(await db.draft.count({ where: { threadId: f.thread.id } })).toBe(0);
  });

  it("blocks duplicate technical forwarding and terminal no-action retries", async () => {
    const technical = await fixture("TECHNICAL_ISSUE");
    const outcomes = await Promise.allSettled([simulateForwardToDiscord(technical.classification.id, db), simulateForwardToDiscord(technical.classification.id, db)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const spam = await fixture("IRRELEVANT_SPAM");
    await expect(runAutomaticProcessing(spam.classification.id, provider(), db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(runThreadClassification(spam.thread.id, provider(), db)).rejects.toBeInstanceOf(WorkflowConflictError);
    // A false spam classification remains explicitly human-correctable.
    await reviewClassification({ classificationId: spam.classification.id, expectedRevision: spam.classification.revision,
      category: "KNOWN_QUESTION" }, db);
    await runAutomaticProcessing(spam.classification.id, provider(), db);
    expect(await db.draft.count({ where: { threadId: spam.thread.id, status: "GENERATED" } })).toBe(1);
  });
});
