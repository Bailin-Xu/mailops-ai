import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { MockAIProvider } from "@/lib/ai/mock-provider";
import { runThreadAutomation } from "@/lib/processing/service";
import { demoCandidatePrefix, demoMessageIds, seedNeutralDemo } from "../scripts/demo/seed";

const db = getDb();

afterAll(async () => {
  const messages = await db.emailMessage.findMany({
    where: { messageId: { in: demoMessageIds } },
    select: { threadId: true },
  });
  const threadIds = messages.map((message) => message.threadId);
  const executions = await db.aIExecution.findMany({
    where: {
      OR: [
        { classification: { threadId: { in: threadIds } } },
        { draft: { threadId: { in: threadIds } } },
      ],
    },
    select: { id: true },
  });
  await db.draftKnowledgeSource.deleteMany({ where: { draft: { threadId: { in: threadIds } } } });
  await db.draft.deleteMany({ where: { threadId: { in: threadIds } } });
  await db.classification.deleteMany({ where: { threadId: { in: threadIds } } });
  await db.aIExecution.deleteMany({ where: { id: { in: executions.map((execution) => execution.id) } } });
  await db.emailMessage.deleteMany({ where: { messageId: { in: demoMessageIds } } });
  await db.emailThread.deleteMany({ where: { id: { in: threadIds } } });
  await db.knowledgeEntry.deleteMany({ where: { sourceCandidate: { fingerprint: { startsWith: demoCandidatePrefix } } } });
  await db.knowledgeCandidate.deleteMany({ where: { fingerprint: { startsWith: demoCandidatePrefix } } });
  await db.$disconnect();
});

describe("neutral synthetic demo", () => {
  it("seeds twice without duplicates and supports both grounded languages and fallback routes", async () => {
    expect(await seedNeutralDemo(db)).toEqual({ imported: 4, duplicate: 0 });
    expect(await seedNeutralDemo(db)).toEqual({ imported: 0, duplicate: 4 });
    const candidates = await db.knowledgeCandidate.findMany({
      where: { fingerprint: { startsWith: demoCandidatePrefix } },
      include: { knowledgeEntry: true, reviewEvents: true },
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.reviewEvents.length === 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.knowledgeEntry?.status === "ACTIVE")).toBe(true);

    const messages = await db.emailMessage.findMany({ where: { messageId: { in: demoMessageIds } } });
    expect(messages).toHaveLength(4);
    for (const message of messages) {
      const classification = await runThreadAutomation(message.threadId, new MockAIProvider(), db);
      const draft = await db.draft.findFirst({ where: { classificationId: classification.id } });
      if (message.messageId?.includes("shipping-")) {
        expect(classification.processingStatus).toBe("DRAFT_READY");
        expect(draft?.status).toBe("GENERATED");
        const language = message.messageId.includes("shipping-fr") ? "fr" : "en";
        expect(draft?.language).toBe(language);
        const answer = candidates.find((candidate) => candidate.language === language)!.proposedAnswer;
        expect(draft?.body).toContain(answer);
      } else {
        expect(classification.processingStatus).toBe(
          message.messageId?.includes("technical-en") ? "TECHNICAL_QUEUED" : "WAITING_FOR_REVIEW",
        );
        expect(draft).toBeNull();
      }
    }

    const edited = candidates[0].knowledgeEntry!;
    await db.knowledgeEntry.update({
      where: { id: edited.id },
      data: { status: "INACTIVE", answer: "A reviewer changed and retired this synthetic answer." },
    });
    await seedNeutralDemo(db);
    await expect(db.knowledgeEntry.findUnique({ where: { id: edited.id } })).resolves.toMatchObject({
      status: "INACTIVE",
      answer: "A reviewer changed and retired this synthetic answer.",
    });
    expect(await db.emailMessage.count({ where: { messageId: { in: demoMessageIds } } })).toBe(4);
  });
});
