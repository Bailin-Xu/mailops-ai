import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { WorkflowConflictError } from "@/lib/workflow/transaction";
import { saveCandidateReview, approvePendingCandidatesInView } from "./candidate-review";
import { splitKnowledgeCandidate } from "./candidate-split";
import { saveKnowledgeSourceReview } from "./review-source";
import { saveWebsiteKnowledgeReview } from "./website-review";

const db = getDb();
const candidates = new Set<string>();
const threads = new Set<string>();
const websites = new Set<string>();
afterEach(async () => {
  await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidates] } } });
  await db.knowledgeCandidate.deleteMany({ where: { parentCandidateId: { in: [...candidates] } } });
  await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidates] } } });
  await db.emailMessage.deleteMany({ where: { threadId: { in: [...threads] } } });
  await db.emailThread.deleteMany({ where: { id: { in: [...threads] } } });
  await db.websiteKnowledgeReviewItem.deleteMany({ where: { id: { in: [...websites] } } });
  candidates.clear(); threads.clear(); websites.clear();
});
afterAll(() => db.$disconnect());

async function candidate() {
  const value = await db.knowledgeCandidate.create({ data: {
    fingerprint: randomUUID(), title: `Review ${randomUUID()}`, canonicalQuestion: "How is tracked delivery provided?",
    proposedAnswer: "The synthetic parcel includes a tracking link.", category: "SHIPPING", language: "en",
  } });
  candidates.add(value.id);
  return value;
}
function review(candidateId: string) {
  return { candidateId, expectedRevision: 0, decision: "APPROVED", title: "Tracked delivery",
    canonicalQuestion: "How is tracked delivery provided?", answer: "The synthetic parcel includes a tracking link.",
    category: "SHIPPING", language: "en", note: "Synthetic human review." };
}

describe("review revision conflicts", () => {
  it("rejects stale candidate edits with no extra event or partial knowledge update", async () => {
    const c = await candidate();
    await saveCandidateReview(review(c.id), db);
    await expect(saveCandidateReview({ ...review(c.id), decision: "REJECTED", answer: "Old tab overwriting the answer." }, db))
      .rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.knowledgeEntry.findUnique({ where: { sourceCandidateId: c.id } })).toMatchObject({ status: "ACTIVE", answer: review(c.id).answer });
    expect(await db.knowledgeCandidateReviewEvent.count({ where: { candidateId: c.id } })).toBe(1);
    await saveCandidateReview({ ...review(c.id), expectedRevision: 1, decision: "REJECTED" }, db);
    expect(await db.knowledgeEntry.findUnique({ where: { sourceCandidateId: c.id } })).toMatchObject({ status: "INACTIVE" });
  });

  it("permits only one concurrent candidate decision and records exactly its event", async () => {
    const c = await candidate();
    const results = await Promise.allSettled([
      saveCandidateReview(review(c.id), db), saveCandidateReview({ ...review(c.id), decision: "REJECTED" }, db),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: c.id } });
    const events = await db.knowledgeCandidateReviewEvent.findMany({ where: { candidateId: c.id } });
    expect(events).toHaveLength(1);
    expect(events[0].decision).toBe(stored.status);
    expect(stored.revision).toBe(1);
  });

  it("does not let split and approval both consume the same pending candidate", async () => {
    const c = await candidate();
    const segments = [1, 2].map((i) => ({ title: `Part ${i}`, canonicalQuestion: `How does synthetic option ${i} work?`, proposedAnswer: "A synthetic answer." }));
    const results = await Promise.allSettled([
      splitKnowledgeCandidate({ candidateId: c.id, expectedRevision: 0, segments }, db), saveCandidateReview(review(c.id), db),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const stored = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: c.id } });
    expect(await db.knowledgeCandidate.count({ where: { parentCandidateId: c.id } })).toBe(stored.status === "REJECTED" ? 2 : 0);
    expect(await db.knowledgeCandidateReviewEvent.count({ where: { candidateId: c.id } })).toBe(1);
  });

  it("bulk approval never overwrites a competing individual decision", async () => {
    const c = await candidate();
    await Promise.allSettled([
      approvePendingCandidatesInView({ source: "ALL", q: c.title, confirmed: "on" }, db),
      saveCandidateReview({ ...review(c.id), decision: "REJECTED" }, db),
    ]);
    const stored = await db.knowledgeCandidate.findUniqueOrThrow({ where: { id: c.id } });
    expect(stored.revision).toBe(1);
    expect(await db.knowledgeCandidateReviewEvent.count({ where: { candidateId: c.id } })).toBe(1);
    const entry = await db.knowledgeEntry.findUnique({ where: { sourceCandidateId: c.id } });
    expect(entry?.status ?? "INACTIVE").toBe(stored.status === "APPROVED" ? "ACTIVE" : "INACTIVE");
  });

  it("protects source and website reviews against old tabs as well", async () => {
    const thread = await db.emailThread.create({ data: {
      subject: "Synthetic source", normalizedSubject: randomUUID(), messages: { create: {
        subject: "Synthetic source", normalizedBody: "Reusable response", cleanBody: "Reusable response", direction: "OUTBOUND",
        sourceFileName: "synthetic-review.eml", fingerprint: randomUUID(),
      } },
    }, include: { messages: true } });
    threads.add(thread.id);
    const messageId = thread.messages[0].id;
    await saveKnowledgeSourceReview({ messageId, expectedRevision: 0, decision: "APPROVED", note: "Reviewed." }, db);
    await expect(saveKnowledgeSourceReview({ messageId, expectedRevision: 0, decision: "REJECTED", note: "Old tab." }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.knowledgeSourceReviewEvent.count({ where: { messageId } })).toBe(1);
    const item = await db.websiteKnowledgeReviewItem.create({ data: { key: randomUUID(), title: "Synthetic policy", questionForOwner: "What is the policy?" } });
    websites.add(item.id);
    const input = { reviewItemId: item.id, expectedRevision: 0, decision: "CONFIRMED", confirmedAnswer: "A verified synthetic policy.", note: "Reviewed." };
    await saveWebsiteKnowledgeReview(input, db);
    await expect(saveWebsiteKnowledgeReview({ ...input, decision: "REJECTED" }, db)).rejects.toBeInstanceOf(WorkflowConflictError);
    expect(await db.websiteKnowledgeReviewEvent.count({ where: { reviewItemId: item.id } })).toBe(1);
  });
});
