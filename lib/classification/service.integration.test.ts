import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { AIProvider } from "@/lib/ai/provider";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import {
  reviewClassification,
  runThreadClassification,
} from "@/lib/classification/service";
import { getDb } from "@/lib/db";

const db = getDb();
const threadIds = new Set<string>();

afterEach(async () => {
  if (!threadIds.size) return;
  const executions = await db.classification.findMany({
    where: { threadId: { in: [...threadIds] } },
    select: { aiExecutionId: true },
  });
  await db.classification.deleteMany({ where: { threadId: { in: [...threadIds] } } });
  await db.aIExecution.deleteMany({
    where: {
      OR: [
        { id: { in: executions.map((row) => row.aiExecutionId) } },
        { provider: "invalid-test" },
      ],
    },
  });
  await db.emailMessage.deleteMany({ where: { threadId: { in: [...threadIds] } } });
  await db.emailThread.deleteMany({ where: { id: { in: [...threadIds] } } });
  threadIds.clear();
});

afterAll(async () => { await db.$disconnect(); });

describe("classification workflow", () => {
  it("stores validated AI output separately from a corrected human decision", async () => {
    const thread = await createInboundThread();
    const classification = await runThreadClassification(thread.id, new MockAIProvider(), db);
    expect(classification).toMatchObject({
      aiCategory: "PAYMENT_ADMINISTRATIVE",
      reviewStatus: "AUTO_ROUTED",
      requiresHumanReview: false,
    });

    const reviewed = await reviewClassification({
      classificationId: classification.id,
      category: "KNOWN_QUESTION",
      note: "Corrected after reading the original French message.",
    }, db);

    expect(reviewed).toMatchObject({
      aiCategory: "PAYMENT_ADMINISTRATIVE",
      reviewedCategory: "KNOWN_QUESTION",
      reviewStatus: "CORRECTED",
    });
    await expect(db.aIExecution.findUnique({ where: { id: classification.aiExecutionId } })).resolves.toMatchObject({ status: "SUCCEEDED", provider: "mock" });
    await expect(db.emailThread.findUnique({ where: { id: thread.id } })).resolves.toMatchObject({ status: "CLASSIFICATION_REVIEWED" });
  });

  it("records invalid provider output as a failed execution without replacing valid data", async () => {
    const thread = await createInboundThread();
    const invalidProvider: AIProvider = {
      id: "invalid-test",
      model: "invalid",
      classificationPromptVersion: "test-v1",
      draftPromptVersion: "test-draft-v1",
      async classifyEmail() { return { category: "NOT_REAL" }; },
      async generateDraft() { return {}; },
    };

    await expect(runThreadClassification(thread.id, invalidProvider, db)).rejects.toThrow("failed validation");
    await expect(db.classification.count({ where: { threadId: thread.id } })).resolves.toBe(0);
    await expect(db.aIExecution.findFirst({ where: { provider: "invalid-test" } })).resolves.toMatchObject({ status: "FAILED" });
  });
});

async function createInboundThread() {
  const unique = randomUUID();
  const thread = await db.emailThread.create({
    data: {
      subject: "Question sur abonnement Artsy",
      normalizedSubject: `question abonnement ${unique}`,
      messages: {
        create: {
          messageId: `<${unique}@mailops.test>`,
          subject: "Question sur abonnement Artsy",
          normalizedBody: "Bonjour, est-ce que le paiement inclut Artsy? Merci.",
          cleanBody: "Bonjour, est-ce que le paiement inclut Artsy? Merci.",
          direction: "INBOUND",
          sourceFileName: "synthetic-classification.eml",
          fingerprint: `classification:${unique}`,
        },
      },
    },
  });
  threadIds.add(thread.id);
  return thread;
}
