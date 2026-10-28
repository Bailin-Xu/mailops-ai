import { spawnSync } from "node:child_process";
import { readFile, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { syntheticFixtures } from "./support/review-fixtures";
import { prepareThreadReconstruction, planHash, reconstructionTransaction } from "@/lib/email/reconstruction/plan";
import { applyThreadReconstruction } from "@/lib/email/reconstruction/apply";
import { readReconstructionSnapshot } from "@/lib/email/reconstruction/snapshot";
import { inspectThreadLineage, resolveCanonicalThreadId } from "@/lib/email/reconstruction/lineage";
import { getMockInboxQueue, parseInboxFilters } from "@/lib/inbox/queue";
import { confirmAndSimulateSend, runThreadAutomation } from "@/lib/processing/service";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { createBugTicket } from "@/lib/bugs/service";
import { scheduleReplyDispatch } from "@/lib/automation/reply-dispatch";
import { getDraftEvidence } from "@/lib/knowledge/history";
import { ingestEml } from "@/lib/email/ingestion";

let fixtures: ReturnType<typeof syntheticFixtures>;
const receipts: string[] = [], extraThreads: string[] = [];
const ownedThreads = new Set<string>();
beforeEach(() => { fixtures = syntheticFixtures(); });
afterEach(async () => {
  const db = fixtures.db;
  await db.auditEvent.deleteMany({ where: { entityType: "ThreadReconstruction", id: { in: receipts.splice(0) } } });
  await db.emailThread.updateMany({ where: { id: { in: extraThreads } }, data: { mergedIntoThreadId: null } });
  await db.emailMessage.deleteMany({ where: { threadId: { in: extraThreads } } });
  await db.emailThread.deleteMany({ where: { id: { in: extraThreads.splice(0) } } });
  // Only these test fixture thread IDs own dispatches/tickets in this file.
  const ids = [...ownedThreads]; ownedThreads.clear();
  const dispatches = await db.replyDispatch.findMany({ where: { threadId: { in: ids } }, select: { id: true } });
  const tickets = await db.bugTicket.findMany({ where: { threadId: { in: ids } }, select: { id: true } });
  await db.auditEvent.deleteMany({ where: { entityId: { in: [...dispatches, ...tickets].map((r) => r.id) } } });
  await db.replyDispatch.deleteMany({ where: { id: { in: dispatches.map((r) => r.id) } } });
  await db.bugTicket.deleteMany({ where: { id: { in: tickets.map((r) => r.id) } } });
  await fixtures.cleanup();
});
async function plan() { const p = await prepareThreadReconstruction(fixtures.db); receipts.push(p.id); return p; }
async function connected() {
  const a = await fixtures.create({ preGenerate: true }), b = await fixtures.create({ preGenerate: true });
  ownedThreads.add(a.threadId); ownedThreads.add(b.threadId);
  const root = await fixtures.db.emailMessage.findFirstOrThrow({ where: { threadId: a.threadId } });
  const child = await fixtures.db.emailMessage.findFirstOrThrow({ where: { threadId: b.threadId } });
  // Preserve source content/hash from generation; header metadata does not change model input.
  await fixtures.db.emailMessage.update({ where: { id: root.id }, data: { messageId: `<${root.id}@example.test>`, sentAt: new Date("2026-01-01") } });
  await fixtures.db.emailMessage.update({ where: { id: child.id }, data: { inReplyTo: `<${root.id}@example.test>`, sentAt: new Date("2026-01-02") } });
  // Changing sentAt changes generation context. Use a fresh attempt for valid pre-merge drafts.
  await runThreadAutomation(a.threadId, new MockAIProvider(), fixtures.db); await runThreadAutomation(b.threadId, new MockAIProvider(), fixtures.db);
  return { a, b, root, child };
}
async function importMessage(messageId: string, parent: string | null, day: number) {
  const eml = Buffer.from(`From: Synthetic <sender@example.test>\r\nTo: Support <support@example.test>\r\nSubject: Identical synthetic subject\r\nDate: ${new Date(Date.UTC(2026, 0, day)).toUTCString()}\r\nMessage-ID: <${messageId}@example.test>\r\n${parent ? `In-Reply-To: <${parent}@example.test>\r\n` : ""}Content-Type: text/plain; charset=utf-8\r\n\r\nBonjour, chaîne synthétique conservée. ${messageId}\r\n`);
  const result = await ingestEml(eml, "synthetic-reconstruction.eml", { db: fixtures.db, ownedAddresses: ["support@example.test"] });
  if (result.status !== "imported") throw new Error("Synthetic import failed."); extraThreads.push(result.threadId); return result;
}

describe("transactional reconstruction and historical attribution", () => {
  it("preserves classification/evidence/source/dispatch/ticket origins, invalidates context and keeps alias navigation reachable", async () => {
    const { a, b, root, child } = await connected(), db = fixtures.db;
    const sent = await db.draft.findFirstOrThrow({ where: { threadId: a.threadId, status: "GENERATED" } });
    await confirmAndSimulateSend({ draftId: sent.id, subject: sent.subject, body: sent.body, language: sent.language }, db);
    const sentBefore = await db.draft.findUniqueOrThrow({ where: { id: sent.id } });
    const delivered = await db.replyDispatch.create({ data: { threadId: a.threadId, draftId: sent.id, state: "SENT", approvalMode: "HUMAN_CONFIRMED",
      idempotencyKey: randomUUID(), delayAt: new Date(), nextAttemptAt: new Date(), sentAt: new Date(), externalMessageId: "synthetic-delivery-history" } });
    const pending = await db.draft.findFirstOrThrow({ where: { threadId: b.threadId, status: "GENERATED" } });
    const evidence = await getDraftEvidence(pending.id, db);
    const dispatch = await db.replyDispatch.create({ data: { threadId: b.threadId, draftId: pending.id, approvalMode: "HUMAN_CONFIRMED", idempotencyKey: randomUUID(), delayAt: new Date(), nextAttemptAt: new Date() } });
    const source = await db.knowledgeCandidateSource.create({ data: { candidateId: b.candidateId, emailMessageId: child.id,
      sourceType: "EMAIL", sourceKey: randomUUID(), sourceLabel: "Synthetic source", sourceExcerpt: "Original source excerpt." } });
    const tech = await fixtures.create(); ownedThreads.add(tech.threadId);
    const techMessage = await db.emailMessage.findFirstOrThrow({ where: { threadId: tech.threadId } });
    await db.emailMessage.update({ where: { id: techMessage.id }, data: { inReplyTo: `<${root.id}@example.test>`, sentAt: new Date("2026-01-03") } });
    const mock = new MockAIProvider();
    const classification = await runThreadAutomation(tech.threadId, { ...mock, id: "mock", model: mock.model, classificationPromptVersion: "synthetic", draftPromptVersion: "synthetic",
      classifyEmail: async () => ({ category: "TECHNICAL_ISSUE", confidence: 0.95, language: "en", requiresHumanReview: false }), generateDraft: mock.generateDraft.bind(mock) }, db);
    const ticket = await createBugTicket({ classificationId: classification.id, report: { summary: "Synthetic technical issue", severity: "LOW" } }, db);
    const beforeClass = await db.classification.findUnique({ where: { id: pending.classificationId } });
    const p = await plan();
    expect((await applyThreadReconstruction(p, db)).status).toBe("APPLIED");
    expect((await applyThreadReconstruction(p, db)).status).toBe("ALREADY_APPLIED");
    expect((await applyThreadReconstruction(await plan(), db)).status).toBe("NO_CHANGE");
    expect(await db.draft.findUnique({ where: { id: sent.id } })).toEqual(sentBefore);
    expect(await db.replyDispatch.findUnique({ where: { id: delivered.id } })).toEqual(delivered);
    expect(await db.classification.findUnique({ where: { id: pending.classificationId } })).toEqual(beforeClass);
    expect((await getDraftEvidence(pending.id, db))?.inputSnapshot).toEqual(evidence?.inputSnapshot);
    expect((await getDraftEvidence(pending.id, db))?.sources).toEqual(evidence?.sources);
    expect(await db.knowledgeCandidateSource.findUnique({ where: { id: source.id } })).toEqual(source);
    expect(await db.bugTicket.findUnique({ where: { id: ticket.id } })).toEqual(ticket);
    expect(await db.replyDispatch.findUnique({ where: { id: dispatch.id } })).toMatchObject({ threadId: b.threadId, draftId: pending.id, state: "CANCELLED" });
    expect(await resolveCanonicalThreadId(b.threadId, db)).toBe(a.threadId);
    expect(await db.emailMessage.findUnique({ where: { id: child.id } })).toMatchObject({ threadId: a.threadId, originalThreadId: b.threadId });
    const history = await inspectThreadLineage({ threadId: b.threadId }, db);
    expect(history?.tickets[0].id).toBe(ticket.id); expect(history?.candidates[0].id).toBe(source.id); expect(history?.sourceThreadCount).toBe(3);
    const queue = await getMockInboxQueue(parseInboxFilters({ selected: b.threadId }), db);
    expect(queue.selected?.id).toBe(a.threadId); expect(queue.selected?.classification).toBeNull(); expect(queue.selected?.messages).toHaveLength(3);
    await expect(confirmAndSimulateSend({ draftId: pending.id, subject: pending.subject, body: pending.body, language: pending.language }, db)).rejects.toThrow("stale");
    await expect(scheduleReplyDispatch({ draftId: pending.id, approvalMode: "AUTO_LOW_RISK" }, { db, minimumConfidence: .7 })).rejects.toThrow("stale");
    await expect(createBugTicket({ classificationId: classification.id, report: { summary: "Stale technical creation", severity: "LOW" } }, db)).rejects.toThrow("stale");
    const current = await runThreadAutomation(a.threadId, mock, db); expect(current.threadRevision).toBeGreaterThan(beforeClass!.threadRevision!);
  });

  it("reconciles late parents, keeps unrelated equal subjects separate, handles cycles and flattens older aliases", async () => {
    const prefix = randomUUID();
    const child = await importMessage(`${prefix}-child`, `${prefix}-middle`, 3);
    await applyThreadReconstruction(await plan(), fixtures.db);
    const middle = await importMessage(`${prefix}-middle`, `${prefix}-root`, 2);
    await applyThreadReconstruction(await plan(), fixtures.db);
    expect(await resolveCanonicalThreadId(child.threadId, fixtures.db)).toBe(middle.threadId);
    const root = await importMessage(`${prefix}-root`, null, 1);
    await importMessage(`${prefix}-standalone`, null, 1);
    await importMessage(`${prefix}-cycle-a`, `${prefix}-cycle-b`, 4);
    await importMessage(`${prefix}-cycle-b`, `${prefix}-cycle-a`, 5);
    await importMessage(`${prefix}-alternate-root`, null, 1);
    await importMessage(`${prefix}-alternate-child`, `${prefix}-alternate-middle`, 3);
    await importMessage(`${prefix}-alternate-middle`, `${prefix}-alternate-root`, 2);
    await applyThreadReconstruction(await plan(), fixtures.db);
    expect(await resolveCanonicalThreadId(child.threadId, fixtures.db)).toBe(root.threadId);
    expect(await fixtures.db.emailMessage.findUnique({ where: { id: child.messageId } })).toMatchObject({ threadId: root.threadId, originalThreadId: child.threadId });
    const groups = await fixtures.db.emailThread.findMany({ where: { id: { in: extraThreads }, mergedIntoThreadId: null }, include: { messages: true } });
    expect(groups.map((g) => g.messages.length).sort()).toEqual([1, 2, 3, 3]);
    for (const group of groups.filter((g) => g.messages.length === 3)) expect(group.messages.map((m) => m.messageId!.replace(/.*-(root|middle|child)(@example\.test.*)$/u, "$1")).sort()).toEqual(["child", "middle", "root"]);
    expect(groups.find((g) => g.id === root.threadId)?.isIncomplete).toBe(false);
  });

  it.each(["body", "reference", "review", "new-message"])("rejects a stale plan after %s changed", async (kind) => {
    const { child, b } = await connected(), db = fixtures.db, p = await plan();
    if (kind === "body") await db.emailMessage.update({ where: { id: child.id }, data: { cleanBody: "Changed French content: réponse." } });
    if (kind === "reference") await db.emailMessage.update({ where: { id: child.id }, data: { references: ["missing@example.test"] } });
    if (kind === "review") await db.classification.updateMany({ where: { threadId: b.threadId }, data: { revision: { increment: 1 } } });
    if (kind === "new-message") await importMessage(randomUUID(), null, 6);
    const state = await reconstructionTransaction(db, readReconstructionSnapshot);
    await expect(applyThreadReconstruction(p, db)).rejects.toThrow("STALE_PLAN");
    expect((await reconstructionTransaction(db, readReconstructionSnapshot)).signature).toBe(state.signature);
  });

  it("rolls back the entire graph when a real database constraint/trigger fails mid-application", async () => {
    const { a, child } = await connected(), db = fixtures.db;
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_synthetic_reconstruction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${a.threadId}'::uuid AND NEW."reconstructedAt" IS NOT NULL THEN RAISE EXCEPTION 'Synthetic rollback'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_synthetic_reconstruction BEFORE UPDATE ON "EmailThread" FOR EACH ROW EXECUTE FUNCTION fail_synthetic_reconstruction()');
    try {
      const p = await plan(), before = await reconstructionTransaction(db, readReconstructionSnapshot);
      await expect(applyThreadReconstruction(p, db)).rejects.toThrow();
      expect((await reconstructionTransaction(db, readReconstructionSnapshot)).signature).toBe(before.signature);
      expect((await db.emailMessage.findUnique({ where: { id: child.id } }))?.threadId).toBe(child.threadId);
      expect(await db.auditEvent.findUnique({ where: { id: p.id } })).toBeNull();
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_synthetic_reconstruction ON "EmailThread"'); await db.$executeRawUnsafe('DROP FUNCTION fail_synthetic_reconstruction()');
    }
  });

  it("blocks conflicting identities and sending leases; rejects a tampered mapping even with a recomputed checksum", async () => {
    const { a, b } = await connected(), db = fixtures.db;
    await db.emailThread.update({ where: { id: a.threadId }, data: { artistId: "synthetic-A" } });
    await db.emailThread.update({ where: { id: b.threadId }, data: { artistId: "synthetic-B" } });
    await expect(applyThreadReconstruction(await plan(), db)).rejects.toThrow("IDENTITY_CONFLICT");
    await db.emailThread.update({ where: { id: b.threadId }, data: { artistId: null } });
    const pending = await db.draft.findFirstOrThrow({ where: { threadId: b.threadId, status: "GENERATED" } });
    await db.replyDispatch.create({ data: { threadId: b.threadId, draftId: pending.id, state: "SENDING", approvalMode: "HUMAN_CONFIRMED", idempotencyKey: randomUUID(), delayAt: new Date(), nextAttemptAt: new Date() } });
    await expect(applyThreadReconstruction(await plan(), db)).rejects.toThrow("SENDING_IN_PROGRESS");
    await db.replyDispatch.updateMany({ where: { draftId: pending.id }, data: { state: "CANCELLED" } });
    const p = await plan(); p.threads[0].isIncomplete = !p.threads[0].isIncomplete; p.planHash = planHash(p);
    await expect(applyThreadReconstruction(p, db)).rejects.toThrow("INVALID_PLAN");
  });
});


it("serializes competing applies without duplicate moves and rejects replay after later graph changes", async () => {
  const { a } = await connected(), db = fixtures.db, p = await plan();
  const outcomes = await Promise.allSettled([applyThreadReconstruction(p, db), applyThreadReconstruction(p, db)]);
  expect(outcomes.filter((result) => result.status === "fulfilled" && result.value.status === "APPLIED")).toHaveLength(1);
  expect((await applyThreadReconstruction(p, db)).status).toBe("ALREADY_APPLIED");
  await db.emailThread.update({ where: { id: a.threadId }, data: { status: "LATER_WORKFLOW_CHANGE" } });
  await expect(applyThreadReconstruction(p, db)).rejects.toThrow("STALE_PLAN");
});

it("keeps canonical inbound evidence valid when only outbound context joins it", async () => {
  const a = await fixtures.create(), b = await fixtures.create(), db = fixtures.db;
  ownedThreads.add(a.threadId); ownedThreads.add(b.threadId);
  const root = await db.emailMessage.findFirstOrThrow({ where: { threadId: a.threadId } });
  const child = await db.emailMessage.findFirstOrThrow({ where: { threadId: b.threadId } });
  await db.emailMessage.update({ where: { id: root.id }, data: { messageId: `<${root.id}@example.test>`, sentAt: new Date("2026-01-01") } });
  await db.emailMessage.update({ where: { id: child.id }, data: { direction: "OUTBOUND", inReplyTo: `<${root.id}@example.test>`, sentAt: new Date("2026-01-02") } });
  await runThreadAutomation(a.threadId, new MockAIProvider(), db);
  const draft = await db.draft.findFirstOrThrow({ where: { threadId: a.threadId } });
  await applyThreadReconstruction(await plan(), db);
  expect((await db.draft.findUnique({ where: { id: draft.id } }))?.knowledgeReviewRequiredAt).toBeNull();
  await expect(confirmAndSimulateSend({ draftId: draft.id, subject: draft.subject, body: draft.body, language: draft.language }, db)).resolves.toMatchObject({ status: "SIMULATED_SENT" });
});


it("CLI separates planning/apply, replays safely and inspects historical IDs without private bodies", async () => {
  const { a, b } = await connected();
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/reconstruct-threads.ts", ...args], {
    encoding: "utf8", timeout: 15000, env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, AI_PROVIDER: "mock", GEMINI_API_KEY: "", GEMINI_MODEL: "" },
  });
  const prepared = run([]); expect(prepared.status, prepared.stderr).toBe(0);
  const output = JSON.parse(prepared.stdout); receipts.push(output.id);
  try {
    expect(output.applied).toBe(false);
    expect((await stat(output.plan)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(output.plan, "utf8")).threads.length).toBeGreaterThan(0);
    const applied = run(["--apply", output.plan]); expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout).status).toBe("APPLIED");
    expect(JSON.parse(run(["--apply", output.plan]).stdout).status).toBe("ALREADY_APPLIED");
    const inspected = run(["--inspect", b.threadId]); expect(inspected.status, inspected.stderr).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({ canonicalThreadId: a.threadId, sourceThreadCount: 2, messageCount: 2 });
    expect(inspected.stdout).not.toContain("normalizedBody");
    const invalid = run(["--inspect", "not-a-uuid"]); expect(invalid.status).toBe(1); expect(invalid.stderr).toContain("RECONSTRUCTION_FAILED");
    expect(invalid.stderr).not.toContain("postgresql://");
  } finally { await unlink(output.plan); }
}, 30_000);
