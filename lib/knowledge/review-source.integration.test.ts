import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { saveKnowledgeSourceReview } from "@/lib/knowledge/review-source";

const db = getDb();
let testThreadId: string | undefined;

afterEach(async () => {
  if (!testThreadId) return;
  await db.emailMessage.deleteMany({ where: { threadId: testThreadId } });
  await db.emailThread.delete({ where: { id: testThreadId } });
  testThreadId = undefined;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("saveKnowledgeSourceReview", () => {
  it("updates the current decision and preserves every review event", async () => {
    const message = await createMessage("OUTBOUND", "A reusable answer with enough detail.");

    await saveKnowledgeSourceReview(
      { messageId: message.id, decision: "NEEDS_FOLLOW_UP", note: "Confirm price." },
      db,
    );
    await saveKnowledgeSourceReview(
      { messageId: message.id, decision: "APPROVED", note: "Price confirmed." },
      db,
    );

    const stored = await db.emailMessage.findUnique({
      where: { id: message.id },
      include: { knowledgeReviewEvents: { orderBy: { createdAt: "asc" } } },
    });

    expect(stored).toMatchObject({
      knowledgeReviewStatus: "APPROVED",
      knowledgeReviewNote: "Price confirmed.",
      knowledgeReviewedAt: expect.any(Date),
    });
    expect(stored?.knowledgeReviewEvents).toEqual([
      expect.objectContaining({ decision: "NEEDS_FOLLOW_UP", note: "Confirm price." }),
      expect.objectContaining({ decision: "APPROVED", note: "Price confirmed." }),
    ]);
  });

  it("does not allow an inbound message to become an approved answer source", async () => {
    const message = await createMessage("INBOUND", "A customer question is not an answer source.");

    await expect(
      saveKnowledgeSourceReview(
        { messageId: message.id, decision: "APPROVED", note: "" },
        db,
      ),
    ).rejects.toThrow("Only an outbound message");

    await expect(
      db.knowledgeSourceReviewEvent.count({ where: { messageId: message.id } }),
    ).resolves.toBe(0);
  });
});

async function createMessage(direction: "INBOUND" | "OUTBOUND", cleanBody: string) {
  const testId = randomUUID();
  const thread = await db.emailThread.create({
    data: {
      subject: "Historical source review test",
      normalizedSubject: "historical source review test",
      messages: {
        create: {
          subject: "Historical source review test",
          normalizedBody: cleanBody,
          cleanBody,
          direction,
          sourceFileName: "synthetic-review.eml",
          fingerprint: `sha256:${testId}`,
        },
      },
    },
    include: { messages: true },
  });
  testThreadId = thread.id;
  const message = thread.messages[0];
  if (!message) throw new Error("Synthetic review message was not created.");
  return message;
}
