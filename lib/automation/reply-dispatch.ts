import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { evaluateAutoReplyPolicy } from "@/lib/automation/reply-policy";
import { z } from "zod";

const scheduleSchema = z.object({
  draftId: z.string().uuid(),
  approvalMode: z.enum(["HUMAN_CONFIRMED", "AUTO_LOW_RISK"]),
  provider: z.enum(["SIMULATED", "GMAIL"]).default("SIMULATED"),
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

const workerSchema = z.object({
  workerId: z.string().trim().min(1).max(200),
});

const failureSchema = z.object({
  dispatchId: z.string().uuid(),
  workerId: z.string().trim().min(1).max(200),
  errorCode: z.string().trim().min(1).max(200),
  retryDelayMinutes: z.number().int().min(1).max(24 * 60).default(15),
});

const sentSchema = z.object({
  dispatchId: z.string().uuid(),
  workerId: z.string().trim().min(1).max(200),
  externalMessageId: z.string().trim().min(1).max(500),
});

export type RuntimeDeliveryPolicy = {
  shadowMode: boolean;
  externalDeliveryEnabled: boolean;
};

export async function scheduleReplyDispatch(
  input: unknown,
  options: {
    db?: PrismaClient;
    now?: Date;
    random?: () => number;
    minimumConfidence?: number;
  } = {},
) {
  const request = scheduleSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const draft = await db.draft.findUnique({
    where: { id: request.draftId },
    include: {
      classification: true,
      knowledgeSources: { include: { knowledgeEntry: true } },
      thread: {
        include: {
          messages: {
            where: { direction: "INBOUND" },
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            take: 1,
          },
        },
      },
    },
  });
  if (!draft) throw new Error("The selected draft no longer exists.");
  if (draft.status !== "GENERATED") throw new Error("Only a generated draft can be scheduled.");

  if (request.approvalMode === "HUMAN_CONFIRMED" && !draft.approvedAt) {
    throw new Error("Human-confirmed scheduling requires an approved draft snapshot.");
  }

  if (request.approvalMode === "AUTO_LOW_RISK") {
    const message = draft.thread.messages[0];
    if (!message) throw new Error("Automatic scheduling requires an inbound message.");
    const activeGroundingSources = draft.knowledgeSources.filter(
      (source) => source.knowledgeEntry.status === "ACTIVE",
    );
    const policy = evaluateAutoReplyPolicy({
      category: draft.classification.reviewedCategory ?? draft.classification.aiCategory,
      confidence: draft.classification.aiConfidence,
      reviewStatus: draft.classification.reviewStatus,
      processingStatus: draft.classification.processingStatus,
      knowledgeMatchCount: activeGroundingSources.length,
      cleanBody: message.cleanBody || message.normalizedBody,
      minimumConfidence: options.minimumConfidence ?? getServerEnv().AUTO_REPLY_MIN_CONFIDENCE,
    });
    if (!policy.eligible) {
      throw new Error(`Automatic reply is blocked: ${policy.reasons.join(", ")}`);
    }
  }

  const random = Math.min(0.999999, Math.max(0, (options.random ?? Math.random)()));
  const delayHours = 2 + Math.floor(random * 14);
  const delayAt = new Date(now.getTime() + delayHours * 60 * 60 * 1000);
  const idempotencyKey = `reply:${draft.id}`;

  try {
    return await db.$transaction(async (transaction) => {
      const existing = await transaction.replyDispatch.findUnique({
        where: { draftId: draft.id },
      });
      if (existing) return existing;

      const dispatch = await transaction.replyDispatch.create({
        data: {
          threadId: draft.threadId,
          draftId: draft.id,
          provider: request.provider,
          approvalMode: request.approvalMode,
          delayAt,
          nextAttemptAt: delayAt,
          idempotencyKey,
          maxAttempts: request.maxAttempts,
        },
      });
      await transaction.emailThread.update({
        where: { id: draft.threadId },
        data: { automationState: "REPLY_SCHEDULED" },
      });
      await transaction.auditEvent.create({
        data: {
          eventType: "REPLY_SCHEDULED",
          entityType: "ReplyDispatch",
          entityId: dispatch.id,
          metadata: {
            threadId: draft.threadId,
            draftId: draft.id,
            approvalMode: request.approvalMode,
            provider: request.provider,
            delayAt: delayAt.toISOString(),
          },
        },
      });
      return dispatch;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return db.replyDispatch.findUniqueOrThrow({ where: { draftId: draft.id } });
    }
    throw error;
  }
}

export async function claimDueReplyDispatch(
  input: unknown,
  options: {
    db?: PrismaClient;
    now?: Date;
    runtimePolicy?: RuntimeDeliveryPolicy;
  } = {},
) {
  const request = workerSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const env = options.runtimePolicy ?? runtimePolicyFromEnvironment();
  const control = await db.safetyControl.upsert({
    where: { id: "global" },
    update: {},
    create: {
      id: "global",
      shadowMode: true,
      externalDeliveryEnabled: false,
      reason: "External delivery is disabled by default.",
    },
  });

  if (
    env.shadowMode
    || !env.externalDeliveryEnabled
    || control.shadowMode
    || !control.externalDeliveryEnabled
  ) {
    return { status: "BLOCKED_BY_SAFETY" as const, dispatch: null };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await db.replyDispatch.findFirst({
      where: {
        state: "REPLY_SCHEDULED",
        nextAttemptAt: { lte: now },
        lockedAt: null,
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return { status: "EMPTY" as const, dispatch: null };

    const claimed = await db.$transaction(async (transaction) => {
      const updated = await transaction.replyDispatch.updateMany({
        where: {
          id: candidate.id,
          state: "REPLY_SCHEDULED",
          lockedAt: null,
        },
        data: {
          state: "SENDING",
          lockedAt: now,
          lockedBy: request.workerId,
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;

      await transaction.emailThread.update({
        where: { id: candidate.threadId },
        data: { automationState: "SENDING" },
      });
      await transaction.auditEvent.create({
        data: {
          eventType: "REPLY_CLAIMED",
          entityType: "ReplyDispatch",
          entityId: candidate.id,
          metadata: { workerId: request.workerId },
        },
      });
      return transaction.replyDispatch.findUniqueOrThrow({ where: { id: candidate.id } });
    });
    if (claimed) return { status: "CLAIMED" as const, dispatch: claimed };
  }

  return { status: "EMPTY" as const, dispatch: null };
}

export async function recordReplyDispatchFailure(
  input: unknown,
  options: { db?: PrismaClient; now?: Date } = {},
) {
  const request = failureSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const current = await db.replyDispatch.findUnique({ where: { id: request.dispatchId } });
  if (!current || current.state !== "SENDING" || current.lockedBy !== request.workerId) {
    throw new Error("This reply dispatch is not claimed by the worker.");
  }
  const terminal = current.attemptCount >= current.maxAttempts;
  const nextAttemptAt = new Date(now.getTime() + request.retryDelayMinutes * 60 * 1000);

  return db.$transaction(async (transaction) => {
    const dispatch = await transaction.replyDispatch.update({
      where: { id: current.id },
      data: {
        state: terminal ? "FAILED" : "REPLY_SCHEDULED",
        nextAttemptAt: terminal ? current.nextAttemptAt : nextAttemptAt,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: request.errorCode,
      },
    });
    await transaction.emailThread.update({
      where: { id: current.threadId },
      data: { automationState: terminal ? "FAILED" : "REPLY_SCHEDULED" },
    });
    await transaction.auditEvent.create({
      data: {
        eventType: terminal ? "REPLY_FAILED" : "REPLY_RETRY_SCHEDULED",
        entityType: "ReplyDispatch",
        entityId: current.id,
        metadata: {
          errorCode: request.errorCode,
          attemptCount: current.attemptCount,
          delayAt: current.delayAt.toISOString(),
          nextAttemptAt: terminal ? null : nextAttemptAt.toISOString(),
        },
      },
    });
    return dispatch;
  });
}

export async function recordReplyDispatchSent(
  input: unknown,
  options: { db?: PrismaClient; now?: Date } = {},
) {
  const request = sentSchema.parse(input);
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const current = await db.replyDispatch.findUnique({ where: { id: request.dispatchId } });
  if (!current || current.state !== "SENDING" || current.lockedBy !== request.workerId) {
    throw new Error("This reply dispatch is not claimed by the worker.");
  }

  return db.$transaction(async (transaction) => {
    const dispatch = await transaction.replyDispatch.update({
      where: { id: current.id },
      data: {
        state: "SENT",
        externalMessageId: request.externalMessageId,
        sentAt: now,
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: null,
      },
    });
    await transaction.emailThread.update({
      where: { id: current.threadId },
      data: { automationState: "SENT" },
    });
    await transaction.auditEvent.create({
      data: {
        eventType: "REPLY_SENT",
        entityType: "ReplyDispatch",
        entityId: current.id,
        metadata: { externalMessageId: request.externalMessageId },
      },
    });
    return dispatch;
  });
}

function runtimePolicyFromEnvironment(): RuntimeDeliveryPolicy {
  const env = getServerEnv();
  return {
    shadowMode: env.SHADOW_MODE,
    externalDeliveryEnabled: env.EXTERNAL_DELIVERY_ENABLED,
  };
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
