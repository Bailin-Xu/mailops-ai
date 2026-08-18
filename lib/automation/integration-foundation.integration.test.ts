import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  claimDueReplyDispatch,
  recordReplyDispatchFailure,
  scheduleReplyDispatch,
} from "@/lib/automation/reply-dispatch";
import {
  claimBugTicket,
  createBugTicket,
  forwardBugTicket,
  submitBugResolution,
} from "@/lib/bugs/service";
import { getDb } from "@/lib/db";
import { SimulatedTechnicalQueueProvider } from "@/lib/integrations/technical-queue-provider";

const db = getDb();
const threadIds = new Set<string>();
const executionIds = new Set<string>();
const auditEntityIds = new Set<string>();
const candidateIds = new Set<string>();

afterEach(async () => {
  await db.safetyControl.upsert({
    where: { id: "global" },
    update: {
      shadowMode: true,
      externalDeliveryEnabled: false,
      reason: "External delivery is disabled for local development.",
    },
    create: { id: "global", shadowMode: true, externalDeliveryEnabled: false },
  });
  if (auditEntityIds.size) {
    await db.auditEvent.deleteMany({ where: { entityId: { in: [...auditEntityIds] } } });
  }
  if (threadIds.size) {
    await db.replyDispatch.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.bugTicket.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.draft.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.classification.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.emailMessage.deleteMany({ where: { threadId: { in: [...threadIds] } } });
    await db.emailThread.deleteMany({ where: { id: { in: [...threadIds] } } });
  }
  if (executionIds.size) {
    await db.aIExecution.deleteMany({ where: { id: { in: [...executionIds] } } });
  }
  if (candidateIds.size) {
    await db.knowledgeEntry.deleteMany({ where: { sourceCandidateId: { in: [...candidateIds] } } });
    await db.knowledgeCandidate.deleteMany({ where: { id: { in: [...candidateIds] } } });
  }
  threadIds.clear();
  executionIds.clear();
  auditEntityIds.clear();
  candidateIds.clear();
});

afterAll(async () => { await db.$disconnect(); });

describe("reply dispatch foundation", () => {
  it("stores one fixed delay and one idempotent dispatch per draft", async () => {
    const fixture = await createFixture("KNOWN_QUESTION", { approved: true, confidence: 0.95 });
    const now = new Date("2026-08-18T12:00:00.000Z");
    const first = await scheduleReplyDispatch({
      draftId: fixture.draftId,
      approvalMode: "HUMAN_CONFIRMED",
      provider: "GMAIL",
    }, { db, now, random: () => 0 });
    auditEntityIds.add(first.id);
    const second = await scheduleReplyDispatch({
      draftId: fixture.draftId,
      approvalMode: "HUMAN_CONFIRMED",
      provider: "GMAIL",
    }, { db, now: new Date("2026-08-19T12:00:00.000Z"), random: () => 0.99 });

    expect(second.id).toBe(first.id);
    expect(first.delayAt.toISOString()).toBe("2026-08-18T14:00:00.000Z");
    expect(second.delayAt).toEqual(first.delayAt);
    expect(second.idempotencyKey).toBe(`reply:${fixture.draftId}`);
  });

  it("schedules an eligible automatic reply no later than 15 hours", async () => {
    const fixture = await createFixture("KNOWN_QUESTION", { confidence: 0.95 });
    const dispatch = await scheduleReplyDispatch({
      draftId: fixture.draftId,
      approvalMode: "AUTO_LOW_RISK",
      provider: "GMAIL",
    }, {
      db,
      now: new Date("2026-08-18T12:00:00.000Z"),
      random: () => 0.999999,
      minimumConfidence: 0.9,
    });
    auditEntityIds.add(dispatch.id);
    expect(dispatch.delayAt.toISOString()).toBe("2026-08-19T03:00:00.000Z");
    expect(dispatch.approvalMode).toBe("AUTO_LOW_RISK");
  });

  it("honors both kill switches and allows only one concurrent worker claim", async () => {
    const fixture = await createFixture("KNOWN_QUESTION", { approved: true, confidence: 0.95 });
    const scheduled = await scheduleReplyDispatch({
      draftId: fixture.draftId,
      approvalMode: "HUMAN_CONFIRMED",
      maxAttempts: 2,
    }, { db, now: new Date("2026-08-18T12:00:00.000Z"), random: () => 0 });
    auditEntityIds.add(scheduled.id);
    const dueAt = new Date("2026-08-18T15:00:00.000Z");
    const runtimeEnabled = { shadowMode: false, externalDeliveryEnabled: true };

    await expect(claimDueReplyDispatch({ workerId: "worker-a" }, {
      db,
      now: dueAt,
      runtimePolicy: runtimeEnabled,
    })).resolves.toMatchObject({ status: "BLOCKED_BY_SAFETY" });

    await db.safetyControl.update({
      where: { id: "global" },
      data: { shadowMode: false, externalDeliveryEnabled: true },
    });
    const claims = await Promise.all([
      claimDueReplyDispatch({ workerId: "worker-a" }, { db, now: dueAt, runtimePolicy: runtimeEnabled }),
      claimDueReplyDispatch({ workerId: "worker-b" }, { db, now: dueAt, runtimePolicy: runtimeEnabled }),
    ]);
    expect(claims.filter((claim) => claim.status === "CLAIMED")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "EMPTY")).toHaveLength(1);

    const claimed = claims.find((claim) => claim.status === "CLAIMED")!;
    const originalDelay = claimed.dispatch!.delayAt;
    const failed = await recordReplyDispatchFailure({
      dispatchId: claimed.dispatch!.id,
      workerId: claimed.dispatch!.lockedBy!,
      errorCode: "SYNTHETIC_TRANSIENT",
      retryDelayMinutes: 30,
    }, { db, now: dueAt });
    expect(failed.state).toBe("REPLY_SCHEDULED");
    expect(failed.delayAt).toEqual(originalDelay);
    expect(failed.nextAttemptAt.toISOString()).toBe("2026-08-18T15:30:00.000Z");
  });
});

describe("bug ticket foundation", () => {
  it("creates idempotently, simulates Discord forwarding, and permits one developer claim", async () => {
    const fixture = await createFixture("TECHNICAL_ISSUE");
    const report = {
      summary: "Synthetic media upload fails after submission",
      page: "/artist/media",
      reproductionSteps: ["Open media form", "Submit synthetic fixture"],
      severity: "HIGH" as const,
      artistId: "synthetic-artist-id",
      wordpressId: null,
      artistEmail: "artist@example.test",
    };
    const first = await createBugTicket({ classificationId: fixture.classificationId, report }, db);
    auditEntityIds.add(first.id);
    const second = await createBugTicket({ classificationId: fixture.classificationId, report }, db);
    expect(second.id).toBe(first.id);

    const queued = await forwardBugTicket(first.id, new SimulatedTechnicalQueueProvider(), db);
    expect(queued).toMatchObject({ status: "QUEUED", discordMessageId: `simulated-discord:${first.id}` });

    const claims = await Promise.all([
      claimBugTicket({ ticketId: first.id, developerExternalId: "developer-a" }, { db }),
      claimBugTicket({ ticketId: first.id, developerExternalId: "developer-b" }, { db }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find(Boolean)!;
    const resolved = await submitBugResolution({
      ticketId: first.id,
      developerExternalId: claimed.assignedDeveloperExternalId!,
      reply: "The synthetic issue has been fixed. Please retry the upload.",
    }, { db });
    expect(resolved).toMatchObject({ status: "RESOLVED" });
    expect(resolved.developerReply).toContain("fixed");
  });
});

async function createFixture(
  category: "KNOWN_QUESTION" | "TECHNICAL_ISSUE",
  options: { approved?: boolean; confidence?: number } = {},
) {
  const unique = randomUUID();
  const execution = await db.aIExecution.create({
    data: {
      taskType: "CLASSIFICATION",
      provider: "synthetic",
      model: "synthetic",
      promptVersion: "integration-foundation-v1",
      status: "SUCCEEDED",
      latencyMs: 0,
      inputMetadata: { fixture: true },
      output: { category },
    },
  });
  executionIds.add(execution.id);
  const thread = await db.emailThread.create({
    data: {
      subject: `Synthetic ${category} ${unique}`,
      normalizedSubject: `synthetic-${unique}`,
      messages: {
        create: {
          messageId: `<${unique}@mailops.test>`,
          subject: `Synthetic ${category}`,
          normalizedBody: "How should framed artwork be prepared for delivery?",
          cleanBody: "How should framed artwork be prepared for delivery?",
          direction: "INBOUND",
          sourceFileName: "synthetic-integration-foundation.eml",
          fingerprint: `integration-foundation:${unique}`,
        },
      },
      classifications: {
        create: {
          aiExecutionId: execution.id,
          aiCategory: category,
          aiConfidence: options.confidence ?? 0.95,
          aiLanguage: "en",
          requiresHumanReview: false,
          reviewStatus: "AUTO_ROUTED",
          route: category === "TECHNICAL_ISSUE" ? "TECHNICAL_QUEUE" : "KNOWN_KNOWLEDGE",
          processingStatus: category === "TECHNICAL_ISSUE" ? "TECHNICAL_QUEUED" : "DRAFT_READY",
          knowledgeMatchCount: category === "KNOWN_QUESTION" ? 1 : 0,
        },
      },
    },
    include: { classifications: true },
  });
  threadIds.add(thread.id);
  const classification = thread.classifications[0]!;
  const draftExecution = await db.aIExecution.create({
    data: {
      taskType: "DRAFT_GENERATION",
      provider: "synthetic",
      model: "synthetic",
      promptVersion: "integration-foundation-v1",
      status: "SUCCEEDED",
      latencyMs: 0,
      inputMetadata: { fixture: true },
      output: { body: "Synthetic grounded reply" },
    },
  });
  executionIds.add(draftExecution.id);
  const draft = await db.draft.create({
    data: {
      threadId: thread.id,
      classificationId: classification.id,
      aiExecutionId: draftExecution.id,
      subject: "Re: Synthetic",
      body: "Synthetic grounded reply.",
      language: "en",
      style: "DORIAN_REFERENCE",
      mode: "MOCK_GROUNDED",
      approvedSubject: options.approved ? "Re: Synthetic" : null,
      approvedBody: options.approved ? "Synthetic grounded reply." : null,
      approvedAt: options.approved ? new Date() : null,
    },
  });
  if (category === "KNOWN_QUESTION") {
    const candidate = await db.knowledgeCandidate.create({
      data: {
        fingerprint: `integration-foundation-knowledge:${unique}`,
        title: "Synthetic framing delivery",
        canonicalQuestion: "How should framed artwork be prepared for delivery?",
        proposedAnswer: "Use the approved synthetic delivery policy.",
        category: "KNOWN_QUESTION",
        language: "en",
        status: "APPROVED",
      },
    });
    candidateIds.add(candidate.id);
    const entry = await db.knowledgeEntry.create({
      data: {
        sourceCandidateId: candidate.id,
        title: candidate.title,
        canonicalQuestion: candidate.canonicalQuestion,
        answer: candidate.proposedAnswer,
        category: candidate.category,
        language: candidate.language,
        status: "ACTIVE",
        approvedAt: new Date(),
      },
    });
    await db.draftKnowledgeSource.create({
      data: {
        draftId: draft.id,
        knowledgeEntryId: entry.id,
        rank: 1,
        relevanceScore: 1,
      },
    });
  }
  return { threadId: thread.id, classificationId: classification.id, draftId: draft.id };
}
