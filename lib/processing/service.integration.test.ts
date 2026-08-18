import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { MockAIProvider } from "@/lib/ai/mock-provider";
import { getDb } from "@/lib/db";
import { ingestAndProcessEml } from "@/lib/processing/ingestion";
import {
  confirmAndSimulateSend,
  correctAndResumeProcessing,
  runThreadAutomation,
  simulateForwardToDiscord,
  submitManualAnswer,
} from "@/lib/processing/service";

const db = getDb();
const threadIds = new Set<string>();
const candidateIds = new Set<string>();

afterEach(async () => {
  let classifications: Array<{
    id: string;
    aiExecutionId: string;
    drafts: Array<{ aiExecutionId: string | null }>;
  }> = [];
  if (threadIds.size) {
    classifications = await db.classification.findMany({
      where: { threadId: { in: [...threadIds] } },
      select: { id: true, aiExecutionId: true, drafts: { select: { aiExecutionId: true } } },
    });
    await db.draftKnowledgeSource.deleteMany({
      where: { draft: { threadId: { in: [...threadIds] } } },
    });
    await db.draft.deleteMany({ where: { threadId: { in: [...threadIds] } } });
  }
  if (candidateIds.size) {
    await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidateIds] } } });
    await db.knowledgeCandidateSource.deleteMany({ where: { candidateId: { in: [...candidateIds] } } });
    await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  }
  if (threadIds.size) {
    await db.classification.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.aIExecution.deleteMany({
      where: {
        id: {
          in: classifications.flatMap((row) => [
            row.aiExecutionId,
            ...row.drafts.flatMap((draft) => draft.aiExecutionId ? [draft.aiExecutionId] : []),
          ]),
        },
      },
    });
    await db.emailMessage.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.emailThread.deleteMany({ where: { id: { in: [...threadIds] } } });
  }
  threadIds.clear();
  candidateIds.clear();
});

afterAll(async () => { await db.$disconnect(); });

describe("automatic processing", () => {
  it("continues from EML ingestion into classification and routing", async () => {
    const id = randomUUID();
    const result = await ingestAndProcessEml(Buffer.from([
      `From: Sender <sender-${id}@example.test>`,
      "To: Support <support@example.test>",
      `Message-ID: <${id}@mailops.test>`,
      "Subject: Upload error",
      "Date: Tue, 18 Aug 2026 12:00:00 +0000",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "Hello, the gallery upload does not work.",
    ].join("\r\n")), "synthetic-ingest-and-process.eml", {
      db,
      provider: new MockAIProvider(),
      ownedAddresses: ["support@example.test"],
    });

    expect(result).toMatchObject({ processing: "COMPLETED" });
    expect(result.ingestion.status).toBe("imported");
    if (result.ingestion.status !== "imported") return;
    threadIds.add(result.ingestion.threadId);
    await expect(db.classification.findUnique({
      where: { id: result.classificationId! },
    })).resolves.toMatchObject({
      reviewStatus: "AUTO_ROUTED",
      route: "TECHNICAL_QUEUE",
      processingStatus: "TECHNICAL_QUEUED",
    });
  });

  it("auto-routes a known question, grounds a reference reply, and requires human simulated-send confirmation", async () => {
    const marker = `atlasrouge${randomUUID().replaceAll("-", "")}`;
    const entry = await createKnowledge(marker);
    const thread = await createInboundThread(
      `${marker} shipping gallery`,
      `Please explain the ${marker} shipping policy for this gallery artwork.`,
    );

    const classification = await runThreadAutomation(thread.id, new MockAIProvider(), db);
    expect(classification).toMatchObject({
      reviewStatus: "AUTO_ROUTED",
      route: "KNOWN_KNOWLEDGE",
      processingStatus: "DRAFT_READY",
      requiresHumanReview: false,
    });

    const draft = await db.draft.findFirstOrThrow({
      where: { classificationId: classification.id },
      include: { knowledgeSources: true },
    });
    expect(draft.body).toContain("Dorian");
    expect(draft.knowledgeSources.map((source) => source.knowledgeEntryId)).toEqual([entry.id]);
    expect(draft.status).toBe("GENERATED");

    await confirmAndSimulateSend(draft.id, db);
    await expect(db.draft.findUnique({ where: { id: draft.id } })).resolves.toMatchObject({
      status: "SIMULATED_SENT",
      approvedBody: draft.body,
    });
  });

  it("routes an art-related decline to manual review instead of treating it as known", async () => {
    const thread = await createInboundThread(
      "Galerie Original",
      "Salut Dorian, merci pour votre temps. Je postulerai à nouveau quand mon profil sera plus développé.",
    );
    const classification = await runThreadAutomation(thread.id, new MockAIProvider(), db);

    expect(classification).toMatchObject({
      aiCategory: "MANUAL_REVIEW",
      reviewStatus: "PENDING",
      route: "MANUAL_REVIEW",
      processingStatus: "WAITING_FOR_REVIEW",
    });
    await expect(db.draft.count({ where: { classificationId: classification.id } })).resolves.toBe(0);
  });

  it("blocks drafting when retrieval matched only a broad title", async () => {
    const marker = `broadtitle${randomUUID().replaceAll("-", "")}`;
    await createTitleOnlyKnowledge(marker);
    const thread = await createInboundThread(
      `${marker} shipping eligibility`,
      `How does ${marker} shipping eligibility work?`,
    );
    const classification = await runThreadAutomation(thread.id, new MockAIProvider(), db);

    expect(classification).toMatchObject({
      aiCategory: "KNOWN_QUESTION",
      reviewStatus: "AUTO_ROUTED",
      route: "KNOWN_KNOWLEDGE",
      processingStatus: "NO_KNOWLEDGE",
      knowledgeMatchCount: 0,
    });
    await expect(db.draft.count({ where: { classificationId: classification.id } })).resolves.toBe(0);
  });

  it("routes a technical issue and records only a simulated Discord forward", async () => {
    const thread = await createInboundThread("Upload error", "Hello, the gallery upload does not work.");
    const classification = await runThreadAutomation(thread.id, new MockAIProvider(), db);
    expect(classification).toMatchObject({ route: "TECHNICAL_QUEUE", processingStatus: "TECHNICAL_QUEUED" });

    await simulateForwardToDiscord(classification.id, db);
    await expect(db.classification.findUnique({ where: { id: classification.id } })).resolves.toMatchObject({
      processingStatus: "SIMULATED_FORWARDED",
    });
  });

  it("blocks low confidence, records correction feedback, then accepts a human answer as a candidate", async () => {
    const thread = await createInboundThread("A small request", "Could someone help me with this?");
    const classification = await runThreadAutomation(thread.id, new MockAIProvider(), db);
    expect(classification).toMatchObject({ reviewStatus: "PENDING", processingStatus: "WAITING_FOR_REVIEW" });

    await correctAndResumeProcessing({
      classificationId: classification.id,
      category: "BUSINESS_PARTNERSHIP",
      note: "Human corrected this to a partnership request with no approved answer.",
    }, new MockAIProvider(), db);
    await expect(db.classification.findUnique({ where: { id: classification.id } })).resolves.toMatchObject({
      reviewStatus: "CORRECTED",
      route: "HUMAN_ANSWER_QUEUE",
      processingStatus: "AWAITING_HUMAN_ANSWER",
      correctionNote: "Human corrected this to a partnership request with no approved answer.",
    });

    await submitManualAnswer({
      classificationId: classification.id,
      body: "A human-verified synthetic answer.",
      createCandidate: true,
    }, db);
    const candidate = await db.knowledgeCandidate.findUniqueOrThrow({
      where: { fingerprint: `manual-answer:${classification.id}` },
    });
    candidateIds.add(candidate.id);
    expect(candidate.status).toBe("PENDING_REVIEW");
    await expect(db.classification.findUnique({ where: { id: classification.id } })).resolves.toMatchObject({
      processingStatus: "SIMULATED_SENT",
    });
  });
});

async function createInboundThread(subject: string, body: string) {
  const id = randomUUID();
  const thread = await db.emailThread.create({
    data: {
      subject,
      normalizedSubject: `${subject.toLocaleLowerCase()}-${id}`,
      messages: {
        create: {
          messageId: `<${id}@mailops.test>`,
          subject,
          normalizedBody: body,
          cleanBody: body,
          direction: "INBOUND",
          sourceFileName: "synthetic-automatic-processing.eml",
          fingerprint: `automatic-processing:${id}`,
        },
      },
    },
  });
  threadIds.add(thread.id);
  return thread;
}

async function createKnowledge(marker: string) {
  const candidate = await db.knowledgeCandidate.create({
    data: {
      fingerprint: `automatic-processing-knowledge:${randomUUID()}`,
      title: `${marker} shipping gallery`,
      canonicalQuestion: `How does ${marker} shipping work for a gallery?`,
      proposedAnswer: "Shipping is arranged using the approved synthetic policy.",
      category: "KNOWN_QUESTION",
      language: "en",
      status: "APPROVED",
    },
  });
  candidateIds.add(candidate.id);
  return db.knowledgeEntry.create({
    data: {
      sourceCandidateId: candidate.id,
      title: `${marker} shipping gallery`,
      canonicalQuestion: `How does ${marker} shipping work for a gallery?`,
      answer: "Shipping is arranged using the approved synthetic policy.",
      category: "KNOWN_QUESTION",
      language: "en",
      status: "ACTIVE",
      approvedAt: new Date(),
    },
  });
}

async function createTitleOnlyKnowledge(marker: string) {
  const candidate = await db.knowledgeCandidate.create({
    data: {
      fingerprint: `automatic-processing-title-only:${randomUUID()}`,
      title: `${marker} shipping eligibility`,
      canonicalQuestion: "What are the monthly opening hours?",
      proposedAnswer: "The synthetic gallery opens at noon.",
      category: "KNOWN_QUESTION",
      language: "en",
      status: "APPROVED",
    },
  });
  candidateIds.add(candidate.id);
  return db.knowledgeEntry.create({
    data: {
      sourceCandidateId: candidate.id,
      title: `${marker} shipping eligibility`,
      canonicalQuestion: "What are the monthly opening hours?",
      answer: "The synthetic gallery opens at noon.",
      category: "KNOWN_QUESTION",
      language: "en",
      status: "ACTIVE",
      approvedAt: new Date(),
    },
  });
}
