import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { syntheticFixtures } from "./support/review-fixtures";
import { saveDraftEdits, rejectDraft, confirmAndSimulateSend, runAutomaticProcessing } from "@/lib/processing/service";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { WorkflowConflictError } from "@/lib/workflow/transaction";
import { saveCandidateReview } from "@/lib/knowledge/candidate-review";
let fixtures: ReturnType<typeof syntheticFixtures>;
beforeEach(() => { fixtures = syntheticFixtures(); });
afterEach(async () => { await fixtures.cleanup(); });
async function ready() {
  const fixture = await fixtures.create({ preGenerate: true });
  const draft = await fixtures.db.draft.findFirstOrThrow({ where: { threadId: fixture.threadId } });
  const edit = { draftId: draft.id, expectedReviewRevision: 0, subject: draft.subject, body: "Human edited text with a verified factual answer.", language: "en" };
  return { ...fixture, draft, edit };
}
describe("independent human draft review", () => {
  it("saves edits separately, rejects stale writes/confirmation, and retains AI original through final confirmation", async () => {
    const f = await ready(), db = fixtures.db;
    const saved = await saveDraftEdits(f.edit, db);
    expect(saved).toMatchObject({ status: "GENERATED", reviewRevision: 1, editedBody: f.edit.body, body: f.draft.body, approvedBody: null });
    await expect(saveDraftEdits(f.edit, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(confirmAndSimulateSend(f.edit, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    const sent = await confirmAndSimulateSend({ ...f.edit, expectedReviewRevision: 1 }, db);
    expect(sent).toMatchObject({ status: "SIMULATED_SENT", approvedBody: f.edit.body, body: f.draft.body, editedBody: f.edit.body });
    await expect(saveDraftEdits({ ...f.edit, expectedReviewRevision: 2 }, db)).rejects.toThrow("no longer ready");
  });
  it("rejects a current reply and preserves it while a new reviewed replacement is generated", async () => {
    const f = await ready(), db = fixtures.db;
    await rejectDraft({ draftId: f.draft.id, expectedReviewRevision: 0, note: "Unsupported wording." }, db);
    await expect(confirmAndSimulateSend(f.edit, db)).rejects.toThrow("no longer ready");
    const replacement = await runAutomaticProcessing(f.draft.classificationId, new MockAIProvider(), db);
    expect(replacement.id).not.toBe(f.draft.id);
    expect(await db.draft.findUnique({ where: { id: f.draft.id } })).toMatchObject({ status: "REJECTED", body: f.draft.body, reviewNote: "Unsupported wording." });
    await confirmAndSimulateSend({ ...f.edit, draftId: replacement.id }, db);
  });
  it("detects competing saved edits and protects a human save from an already in-flight regeneration", async () => {
    const f = await ready(), db = fixtures.db;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const base = new MockAIProvider();
    const pending = runAutomaticProcessing(f.draft.classificationId, { ...base,
      id: "mock", model: base.model, classificationPromptVersion: base.classificationPromptVersion, draftPromptVersion: base.draftPromptVersion,
      classifyEmail: base.classifyEmail.bind(base), generateDraft: async (input) => { entered(); await gate; return base.generateDraft(input); } }, db);
    await started;
    try {
      const results = await Promise.allSettled([saveDraftEdits(f.edit, db), saveDraftEdits({ ...f.edit, body: "Competing human review text." }, db)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    } finally { release(); }
    await expect(pending).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.draft.count({ where: { threadId: f.threadId } })).toBe(1);
    expect(await db.draft.findUnique({ where: { id: f.draft.id } })).toMatchObject({ status: "GENERATED", reviewRevision: 1 });
  });
  it("saved edits remain affected by changed knowledge, cannot be confirmed, but may be explicitly rejected", async () => {
    const f = await ready(), db = fixtures.db;
    await saveDraftEdits(f.edit, db);
    const candidate = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: f.candidateId } });
    await saveCandidateReview({ candidateId: candidate.id, expectedRevision: candidate.revision, decision: "APPROVED", title: f.title,
      canonicalQuestion: f.question, answer: "Updated approved shipping answer.", category: "SHIPPING", language: "en", note: "Synthetic correction." }, db);
    await expect(confirmAndSimulateSend({ ...f.edit, expectedReviewRevision: 1 }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    await expect(rejectDraft({ draftId: f.draft.id, expectedReviewRevision: 1, note: "Outdated evidence." }, db)).resolves.toMatchObject({ status: "REJECTED", editedBody: f.edit.body });
  });
});
